//-
//*****************************************************************************
// Copyright (c) 2019 Morten Bojsen-Hansen
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//*****************************************************************************
//+

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader, ISceneLoaderPlugin, ISceneLoaderPluginExtensions } from '@babylonjs/core/Loading/sceneLoader';
import { Vector3 } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Nullable } from '@babylonjs/core/types';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { IParticleSystem } from '@babylonjs/core/Particles/IParticleSystem';
import { MorphTarget } from '@babylonjs/core/Morph/morphTarget';
import { MorphTargetManager } from '@babylonjs/core/Morph/morphTargetManager';

type Header = {
    scale: Vector3;
    translate: Vector3,
    numSkins: number,
    skinWidth: number,
    skinHeight: number,
    numVertices: number,
    numTriangles: number,
    numFrames: number
};

type Frame = {
    positions: Float32Array
    normals: Float32Array
};

export class MDLFileLoader implements ISceneLoaderPlugin
{
    public name = "mdl";

    public extensions: ISceneLoaderPluginExtensions = {
        ".mdl": { isBinary: true },
    };

     /**
     * Import meshes into a scene.
     * @param meshesNames An array of mesh names, a single mesh name, or empty string for all meshes that filter what meshes are imported
     * @param scene The scene to import into
     * @param data The data to import
     * @param rootUrl The root url for scene and resources
     * @param meshes The meshes array to import into
     * @param particleSystems The particle systems array to import into
     * @param skeletons The skeletons array to import into
     * @param onError The callback when import fails
     * @returns True if successful or false otherwise
     */
    public importMesh(
        meshesNames: any,
        scene: Scene,
        data: any,
        rootUrl: string,
        meshes: Nullable<AbstractMesh[]>,
        particleSystems: Nullable<IParticleSystem[]>,
        skeletons: Nullable<Skeleton[]>): boolean
    {
        let r = new BinaryReader(data);

        if (r.readInt32() != 1330660425 || r.readInt32() != 6) {
            window.alert("Not a Quake MDL or wrong MDL version.");
            return false;
        }

        let scale = new Vector3(r.readFloat32(), r.readFloat32(), r.readFloat32());
        let translate = new Vector3(r.readFloat32(), r.readFloat32(), r.readFloat32());
        r.skipBytes(4*4); // float boundingradius, vec3 eyepos

        let numSkins = r.readInt32();
        let skinWidth = r.readInt32();
        let skinHeight = r.readInt32();

        let numVertices = r.readInt32();
        let numTriangles = r.readInt32();
        let numFrames = r.readInt32();

        r.skipBytes(4*3); // int synctype, int flags, float size

        let header : Header = {
            scale,
            translate,
            numSkins,
            skinWidth,
            skinHeight,
            numVertices,
            numTriangles,
            numFrames };

        if (false) {
            document.write('scale=' + header.scale + '<br>')
            document.write('translate=' + header.translate + '<br>')
            document.write('numSkins=' + header.numSkins + '<br>')
            document.write('skins=' + header.skinWidth+' * '+header.skinHeight + '<br>')
            document.write('numVertices=' + header.numVertices + '<br>')
            document.write('numTriangles=' + header.numTriangles + '<br>')
            document.write('numFrames=' + header.numFrames + '<br>')
        }

        let textures : Array<BaseTexture> = [];
        for (let index=0; index<header.numSkins; ++index) {
            let group = r.readInt32();
            if (group != 0) {
                window.alert("Skin " + index + " is a group skin, which we don't support yet.");
                return false;
            }
            else {
                let data = new Uint8Array(3*header.skinWidth*header.skinHeight);

                for (let i=0; i<header.skinWidth*header.skinHeight; ++i)
                {
                    let color = colorMap[r.readUint8()];
                    data[3*i+0] = color[0];
                    data[3*i+1] = color[1];
                    data[3*i+2] = color[2];
                }

                let texture = new RawTexture(
                    data,
                    header.skinWidth,
                    header.skinHeight,
                    Engine.TEXTUREFORMAT_RGB,
                    scene,
                    false, // generate mip maps
                    false, // invertY
                    RawTexture.TRILINEAR_SAMPLINGMODE,
                    //RawTexture.LINEAR_LINEAR,
                    Engine.TEXTURETYPE_UNSIGNED_BYTE);

                /*
                texture.wrapU = RawTexture.CLAMP_ADDRESSMODE;
                texture.wrapV = RawTexture.CLAMP_ADDRESSMODE;
                texture.wrapR = RawTexture.CLAMP_ADDRESSMODE;
                */

                textures.push(texture);
            }
        }

        // uvs
        let onSeam = new Uint32Array(header.numVertices);
        let uvs = new Float32Array(2*header.numVertices);

        for (let i=0; i<header.numVertices; ++i) {
            onSeam[i] = r.readInt32();
            uvs[2*i+0] = r.readInt32();
            uvs[2*i+1] = r.readInt32();
        }

        // triangles
        let indices = new Uint32Array(3*header.numTriangles);
        let backside = new Uint8Array(header.numVertices);
        backside.fill(3);

        let faceFront = new Uint32Array(header.numTriangles);
        for (let i=0; i<header.numTriangles; ++i) {
            let facesFront = r.readInt32();
            faceFront[i] = facesFront;

            for (let j=0; j<3; ++j) {
            let vertexIndex = r.readInt32();
            //document.write('= '+backside[vertexIndex]+'<br>')

            //if (!facesFront && onSeam[vertexIndex]) {
            if (onSeam[vertexIndex]) {
                backside[vertexIndex] = 1;
            }
            /*
            let n : number;

            if (!facesFront && onSeam[vertexIndex]) {
                n = 1;
            }
            else {
                n = 0;
            }

            if (backside[vertexIndex] == 3) {
                backside[vertexIndex] = n;
            }
            else if (backside[vertexIndex] != 2 && backside[vertexIndex] != n) {
                backside[vertexIndex] = 2;
            }
            */

            indices[3*i+j] = vertexIndex;
            }
        }

        /*
        for (let i=0; i<header.numVertices; ++i) {
            let s = uvs[2*i+0];
            let t = uvs[2*i+1];

            if (backside[i] == 1) {
                s += 0.5 * header.skinWidth;
            }

            uvs[2*i+0] = (s + 0.5) / header.skinWidth;
            uvs[2*i+1] = (t + 0.5) / header.skinHeight;
        }*/

        // read frames

        let vertexData = new VertexData();

        let indices2 = new Uint32Array(3*header.numTriangles);
        for (let i=0; i<header.numTriangles; ++i) {
            for (let j=0; j<3; ++j) {
                let idx = 3*i+j;
                let vertexIndex = indices[idx];
                indices2[idx] = (j + 3*i);
            }
        }

        let mesh = new Mesh("", scene);
        vertexData.positions = new Float32Array(3*3*header.numTriangles);
        vertexData.normals = new Float32Array(3*3*header.numTriangles);
        vertexData.uvs = new Float32Array(2*3*header.numTriangles);
        vertexData.indices = indices2;
        vertexData.applyToMesh(mesh);
        let material = new StandardMaterial("", scene);
        material.diffuseTexture = textures[0];
        mesh.material = material;

        let manager = new MorphTargetManager();
        mesh.morphTargetManager = manager;

        meshes.push(mesh);

        for (let i=0; i<header.numFrames; ++i) {
            // non-group frame
            if (r.readInt32() == 0) {
                let frame = this.parseFrame(r, header);
                vertexData.positions = frame.positions;
                vertexData.normals = frame.normals;

                vertexData.indices = indices;
                vertexData.uvs = uvs;

                {
                    let positions2 = new Float32Array(3*3*header.numTriangles);
                    let normals2 = new Float32Array(3*3*header.numTriangles);
                    let uvs2 = new Float32Array(2*3*header.numTriangles);
                    // let indices2 = new Uint32Array(3*header.numTriangles);
                    for (let i=0; i<header.numTriangles; ++i) {
                        for (let j=0; j<3; ++j) {
                            let idx = 3*i+j;
                            let vertexIndex = indices[idx];

                            positions2[3*idx+0] = vertexData.positions[3*vertexIndex+0];
                            positions2[3*idx+1] = vertexData.positions[3*vertexIndex+1];
                            positions2[3*idx+2] = vertexData.positions[3*vertexIndex+2];

                            normals2[3*idx+0] = vertexData.normals[3*vertexIndex+0];
                            normals2[3*idx+1] = vertexData.normals[3*vertexIndex+1];
                            normals2[3*idx+2] = vertexData.normals[3*vertexIndex+2];

                            uvs2[2*idx+0] = vertexData.uvs[2*vertexIndex+0];
                            uvs2[2*idx+1] = vertexData.uvs[2*vertexIndex+1];
                            let s = vertexData.uvs[2*vertexIndex+0];
                            let t = vertexData.uvs[2*vertexIndex+1];

                            if (!faceFront[i] && onSeam[vertexIndex]) {
                                s += 0.5 * header.skinWidth;
                            }

                            uvs2[2*idx+0] = (s + 0.5) / header.skinWidth;
                            uvs2[2*idx+1] = (t + 0.5) / header.skinHeight;

                            // indices2[idx] = (j + 3*i);
                        }
                    }

                    /*
                    vertexData.positions = positions2;
                    vertexData.normals = normals2;
                    vertexData.uvs = uvs2;
                    vertexData.indices = indices2;

                    let mesh = new Mesh("", scene);
                    vertexData.applyToMesh(mesh);
                    let material = new StandardMaterial("", scene);
                    material.diffuseTexture = textures[0];
                    mesh.material = material;

                    meshes.push(mesh);
                    */

                    let target = new MorphTarget("", 0);
                    target.setPositions(positions2);
                    target.setNormals(normals2);
                    target.setUVs(uvs2);

                    manager.addTarget(target);
                }
            }
            else {
                let numFramesInGroup = r.readInt32();
                r.skipBytes(3*4); // min, max
                r.skipBytes(4*(numFramesInGroup)); // interval
                for (let j=0; j<numFramesInGroup; ++j) {
                    let frame = this.parseFrame(r, header);
                }
            }
        }

        return true;
    }

    private parseFrame(
        r: BinaryReader,
        header: Header): Frame
    {
        r.skipBytes(2*4 + 16); // bboxmin, bboxmax, name[16]

        let positions = new Float32Array(3*header.numVertices);
        let normals = new Float32Array(3*header.numVertices);
        let uvs = new Float32Array(2*header.numVertices);

        for (let i=0; i<header.numVertices; ++i) {
            positions[3*i+0] = r.readUint8() * header.scale.x + header.translate.x;
            positions[3*i+1] = r.readUint8() * header.scale.y + header.translate.y;
            positions[3*i+2] = r.readUint8() * header.scale.z + header.translate.z;

            let normalIndex = r.readUint8();
            normals[3*i+0] = anormals[normalIndex][0];
            normals[3*i+1] = anormals[normalIndex][1];
            normals[3*i+2] = anormals[normalIndex][2];

            //document.write('('+positions[3*i+0]+', '+positions[3*i+1]+', '+positions[3*i+2]+')<br>');
        }

        return { positions, normals };
    }

    /**
     * Load into a scene.
     * @param scene The scene to load into
     * @param data The data to import
     * @param rootUrl The root url for scene and resources
     * @param onError The callback when import fails
     * @returns true if successful or false otherwise
     */
    public load(
        scene: Scene,
        data: any,
        rootUrl: string): boolean
    {
        let result = this.importMesh(null, scene, data, rootUrl, null, null, null);

        if (result) {
            //scene.createDefaultLight();
            //scene.createDefaultCameraOrLight();
        }

        return result;
    }

    /**
     * Load into an asset container.
     * @param scene The scene to load into
     * @param data The data to import
     * @param rootUrl The root url for scene and resources
     * @param onError The callback when import fails
     * @returns The loaded asset container
     */
    public loadAssetContainer(
        scene: Scene,
        data: string,
        rootUrl: string,
        onError?: (message: string, exception?: any) => void): AssetContainer
    {
        let container = new AssetContainer(scene);
        this.importMesh(null, scene, data, rootUrl, container.meshes, null, null);
        container.removeAllFromScene();
        return container;
    }
}

class BinaryReader {
    private _arrayBuffer: ArrayBuffer;
    private _dataView: DataView;
    private _byteOffset: number;

    constructor(arrayBuffer: ArrayBuffer) {
        this._arrayBuffer = arrayBuffer;
        this._dataView = new DataView(arrayBuffer);
        this._byteOffset = 0;
    }

    public getPosition(): number {
        return this._byteOffset;
    }

    public getLength(): number {
        return this._arrayBuffer.byteLength;
    }

    public readUint8(): number {
        const value = this._dataView.getUint8(this._byteOffset);
        this._byteOffset += 1;
        return value;
    }

    public readInt32(): number {
        const value = this._dataView.getInt32(this._byteOffset, true);
        this._byteOffset += 4;
        return value;
    }

    public readUint32(): number {
        const value = this._dataView.getUint32(this._byteOffset, true);
        this._byteOffset += 4;
        return value;
    }

    public readFloat32(): number {
        const value = this._dataView.getFloat32(this._byteOffset, true);
        this._byteOffset += 4;
        return value;
    }

    public readUint8Array(length: number): Uint8Array {
        const value = new Uint8Array(this._arrayBuffer, this._byteOffset, length);
        this._byteOffset += length;
        return value;
    }

    public skipBytes(length: number): void {
        this._byteOffset += length;
    }
}

var anormals = [
    [ -0.525731,  0.000000,  0.850651 ],
    [ -0.442863,  0.238856,  0.864188 ],
    [ -0.295242,  0.000000,  0.955423 ],
    [ -0.309017,  0.500000,  0.809017 ],
    [ -0.162460,  0.262866,  0.951056 ],
    [  0.000000,  0.000000,  1.000000 ],
    [  0.000000,  0.850651,  0.525731 ],
    [ -0.147621,  0.716567,  0.681718 ],
    [  0.147621,  0.716567,  0.681718 ],
    [  0.000000,  0.525731,  0.850651 ],
    [  0.309017,  0.500000,  0.809017 ],
    [  0.525731,  0.000000,  0.850651 ],
    [  0.295242,  0.000000,  0.955423 ],
    [  0.442863,  0.238856,  0.864188 ],
    [  0.162460,  0.262866,  0.951056 ],
    [ -0.681718,  0.147621,  0.716567 ],
    [ -0.809017,  0.309017,  0.500000 ],
    [ -0.587785,  0.425325,  0.688191 ],
    [ -0.850651,  0.525731,  0.000000 ],
    [ -0.864188,  0.442863,  0.238856 ],
    [ -0.716567,  0.681718,  0.147621 ],
    [ -0.688191,  0.587785,  0.425325 ],
    [ -0.500000,  0.809017,  0.309017 ],
    [ -0.238856,  0.864188,  0.442863 ],
    [ -0.425325,  0.688191,  0.587785 ],
    [ -0.716567,  0.681718, -0.147621 ],
    [ -0.500000,  0.809017, -0.309017 ],
    [ -0.525731,  0.850651,  0.000000 ],
    [  0.000000,  0.850651, -0.525731 ],
    [ -0.238856,  0.864188, -0.442863 ],
    [  0.000000,  0.955423, -0.295242 ],
    [ -0.262866,  0.951056, -0.162460 ],
    [  0.000000,  1.000000,  0.000000 ],
    [  0.000000,  0.955423,  0.295242 ],
    [ -0.262866,  0.951056,  0.162460 ],
    [  0.238856,  0.864188,  0.442863 ],
    [  0.262866,  0.951056,  0.162460 ],
    [  0.500000,  0.809017,  0.309017 ],
    [  0.238856,  0.864188, -0.442863 ],
    [  0.262866,  0.951056, -0.162460 ],
    [  0.500000,  0.809017, -0.309017 ],
    [  0.850651,  0.525731,  0.000000 ],
    [  0.716567,  0.681718,  0.147621 ],
    [  0.716567,  0.681718, -0.147621 ],
    [  0.525731,  0.850651,  0.000000 ],
    [  0.425325,  0.688191,  0.587785 ],
    [  0.864188,  0.442863,  0.238856 ],
    [  0.688191,  0.587785,  0.425325 ],
    [  0.809017,  0.309017,  0.500000 ],
    [  0.681718,  0.147621,  0.716567 ],
    [  0.587785,  0.425325,  0.688191 ],
    [  0.955423,  0.295242,  0.000000 ],
    [  1.000000,  0.000000,  0.000000 ],
    [  0.951056,  0.162460,  0.262866 ],
    [  0.850651, -0.525731,  0.000000 ],
    [  0.955423, -0.295242,  0.000000 ],
    [  0.864188, -0.442863,  0.238856 ],
    [  0.951056, -0.162460,  0.262866 ],
    [  0.809017, -0.309017,  0.500000 ],
    [  0.681718, -0.147621,  0.716567 ],
    [  0.850651,  0.000000,  0.525731 ],
    [  0.864188,  0.442863, -0.238856 ],
    [  0.809017,  0.309017, -0.500000 ],
    [  0.951056,  0.162460, -0.262866 ],
    [  0.525731,  0.000000, -0.850651 ],
    [  0.681718,  0.147621, -0.716567 ],
    [  0.681718, -0.147621, -0.716567 ],
    [  0.850651,  0.000000, -0.525731 ],
    [  0.809017, -0.309017, -0.500000 ],
    [  0.864188, -0.442863, -0.238856 ],
    [  0.951056, -0.162460, -0.262866 ],
    [  0.147621,  0.716567, -0.681718 ],
    [  0.309017,  0.500000, -0.809017 ],
    [  0.425325,  0.688191, -0.587785 ],
    [  0.442863,  0.238856, -0.864188 ],
    [  0.587785,  0.425325, -0.688191 ],
    [  0.688191,  0.587785, -0.425325 ],
    [ -0.147621,  0.716567, -0.681718 ],
    [ -0.309017,  0.500000, -0.809017 ],
    [  0.000000,  0.525731, -0.850651 ],
    [ -0.525731,  0.000000, -0.850651 ],
    [ -0.442863,  0.238856, -0.864188 ],
    [ -0.295242,  0.000000, -0.955423 ],
    [ -0.162460,  0.262866, -0.951056 ],
    [  0.000000,  0.000000, -1.000000 ],
    [  0.295242,  0.000000, -0.955423 ],
    [  0.162460,  0.262866, -0.951056 ],
    [ -0.442863, -0.238856, -0.864188 ],
    [ -0.309017, -0.500000, -0.809017 ],
    [ -0.162460, -0.262866, -0.951056 ],
    [  0.000000, -0.850651, -0.525731 ],
    [ -0.147621, -0.716567, -0.681718 ],
    [  0.147621, -0.716567, -0.681718 ],
    [  0.000000, -0.525731, -0.850651 ],
    [  0.309017, -0.500000, -0.809017 ],
    [  0.442863, -0.238856, -0.864188 ],
    [  0.162460, -0.262866, -0.951056 ],
    [  0.238856, -0.864188, -0.442863 ],
    [  0.500000, -0.809017, -0.309017 ],
    [  0.425325, -0.688191, -0.587785 ],
    [  0.716567, -0.681718, -0.147621 ],
    [  0.688191, -0.587785, -0.425325 ],
    [  0.587785, -0.425325, -0.688191 ],
    [  0.000000, -0.955423, -0.295242 ],
    [  0.000000, -1.000000,  0.000000 ],
    [  0.262866, -0.951056, -0.162460 ],
    [  0.000000, -0.850651,  0.525731 ],
    [  0.000000, -0.955423,  0.295242 ],
    [  0.238856, -0.864188,  0.442863 ],
    [  0.262866, -0.951056,  0.162460 ],
    [  0.500000, -0.809017,  0.309017 ],
    [  0.716567, -0.681718,  0.147621 ],
    [  0.525731, -0.850651,  0.000000 ],
    [ -0.238856, -0.864188, -0.442863 ],
    [ -0.500000, -0.809017, -0.309017 ],
    [ -0.262866, -0.951056, -0.162460 ],
    [ -0.850651, -0.525731,  0.000000 ],
    [ -0.716567, -0.681718, -0.147621 ],
    [ -0.716567, -0.681718,  0.147621 ],
    [ -0.525731, -0.850651,  0.000000 ],
    [ -0.500000, -0.809017,  0.309017 ],
    [ -0.238856, -0.864188,  0.442863 ],
    [ -0.262866, -0.951056,  0.162460 ],
    [ -0.864188, -0.442863,  0.238856 ],
    [ -0.809017, -0.309017,  0.500000 ],
    [ -0.688191, -0.587785,  0.425325 ],
    [ -0.681718, -0.147621,  0.716567 ],
    [ -0.442863, -0.238856,  0.864188 ],
    [ -0.587785, -0.425325,  0.688191 ],
    [ -0.309017, -0.500000,  0.809017 ],
    [ -0.147621, -0.716567,  0.681718 ],
    [ -0.425325, -0.688191,  0.587785 ],
    [ -0.162460, -0.262866,  0.951056 ],
    [  0.442863, -0.238856,  0.864188 ],
    [  0.162460, -0.262866,  0.951056 ],
    [  0.309017, -0.500000,  0.809017 ],
    [  0.147621, -0.716567,  0.681718 ],
    [  0.000000, -0.525731,  0.850651 ],
    [  0.425325, -0.688191,  0.587785 ],
    [  0.587785, -0.425325,  0.688191 ],
    [  0.688191, -0.587785,  0.425325 ],
    [ -0.955423,  0.295242,  0.000000 ],
    [ -0.951056,  0.162460,  0.262866 ],
    [ -1.000000,  0.000000,  0.000000 ],
    [ -0.850651,  0.000000,  0.525731 ],
    [ -0.955423, -0.295242,  0.000000 ],
    [ -0.951056, -0.162460,  0.262866 ],
    [ -0.864188,  0.442863, -0.238856 ],
    [ -0.951056,  0.162460, -0.262866 ],
    [ -0.809017,  0.309017, -0.500000 ],
    [ -0.864188, -0.442863, -0.238856 ],
    [ -0.951056, -0.162460, -0.262866 ],
    [ -0.809017, -0.309017, -0.500000 ],
    [ -0.681718,  0.147621, -0.716567 ],
    [ -0.681718, -0.147621, -0.716567 ],
    [ -0.850651,  0.000000, -0.525731 ],
    [ -0.688191,  0.587785, -0.425325 ],
    [ -0.587785,  0.425325, -0.688191 ],
    [ -0.425325,  0.688191, -0.587785 ],
    [ -0.425325, -0.688191, -0.587785 ],
    [ -0.587785, -0.425325, -0.688191 ],
    [ -0.688191, -0.587785, -0.425325 ]
];

var colorMap = [
    [  0,   0,   0], [ 15,  15,  15], [ 31,  31,  31], [ 47,  47,  47],
    [ 63,  63,  63], [ 75,  75,  75], [ 91,  91,  91], [107, 107, 107],
    [123, 123, 123], [139, 139, 139], [155, 155, 155], [171, 171, 171],
    [187, 187, 187], [203, 203, 203], [219, 219, 219], [235, 235, 235],
    [ 15,  11,   7], [ 23,  15,  11], [ 31,  23,  11], [ 39,  27,  15],
    [ 47,  35,  19], [ 55,  43,  23], [ 63,  47,  23], [ 75,  55,  27],
    [ 83,  59,  27], [ 91,  67,  31], [ 99,  75,  31], [107,  83,  31],
    [115,  87,  31], [123,  95,  35], [131, 103,  35], [143, 111,  35],
    [ 11,  11,  15], [ 19,  19,  27], [ 27,  27,  39], [ 39,  39,  51],
    [ 47,  47,  63], [ 55,  55,  75], [ 63,  63,  87], [ 71,  71, 103],
    [ 79,  79, 115], [ 91,  91, 127], [ 99,  99, 139], [107, 107, 151],
    [115, 115, 163], [123, 123, 175], [131, 131, 187], [139, 139, 203],
    [  0,   0,   0], [  7,   7,   0], [ 11,  11,   0], [ 19,  19,   0],
    [ 27,  27,   0], [ 35,  35,   0], [ 43,  43,   7], [ 47,  47,   7],
    [ 55,  55,   7], [ 63,  63,   7], [ 71,  71,   7], [ 75,  75,  11],
    [ 83,  83,  11], [ 91,  91,  11], [ 99,  99,  11], [107, 107,  15],
    [  7,   0,   0], [ 15,   0,   0], [ 23,   0,   0], [ 31,   0,   0],
    [ 39,   0,   0], [ 47,   0,   0], [ 55,   0,   0], [ 63,   0,   0],
    [ 71,   0,   0], [ 79,   0,   0], [ 87,   0,   0], [ 95,   0,   0],
    [103,   0,   0], [111,   0,   0], [119,   0,   0], [127,   0,   0],
    [ 19,  19,   0], [ 27,  27,   0], [ 35,  35,   0], [ 47,  43,   0],
    [ 55,  47,   0], [ 67,  55,   0], [ 75,  59,   7], [ 87,  67,   7],
    [ 95,  71,   7], [107,  75,  11], [119,  83,  15], [131,  87,  19],
    [139,  91,  19], [151,  95,  27], [163,  99,  31], [175, 103,  35],
    [ 35,  19,   7], [ 47,  23,  11], [ 59,  31,  15], [ 75,  35,  19],
    [ 87,  43,  23], [ 99,  47,  31], [115,  55,  35], [127,  59,  43],
    [143,  67,  51], [159,  79,  51], [175,  99,  47], [191, 119,  47],
    [207, 143,  43], [223, 171,  39], [239, 203,  31], [255, 243,  27],
    [ 11,   7,   0], [ 27,  19,   0], [ 43,  35,  15], [ 55,  43,  19],
    [ 71,  51,  27], [ 83,  55,  35], [ 99,  63,  43], [111,  71,  51],
    [127,  83,  63], [139,  95,  71], [155, 107,  83], [167, 123,  95],
    [183, 135, 107], [195, 147, 123], [211, 163, 139], [227, 179, 151],
    [171, 139, 163], [159, 127, 151], [147, 115, 135], [139, 103, 123],
    [127,  91, 111], [119,  83,  99], [107,  75,  87], [ 95,  63,  75],
    [ 87,  55,  67], [ 75,  47,  55], [ 67,  39,  47], [ 55,  31,  35],
    [ 43,  23,  27], [ 35,  19,  19], [ 23,  11,  11], [ 15,   7,   7],
    [187, 115, 159], [175, 107, 143], [163,  95, 131], [151,  87, 119],
    [139,  79, 107], [127,  75,  95], [115,  67,  83], [107,  59,  75],
    [ 95,  51,  63], [ 83,  43,  55], [ 71,  35,  43], [ 59,  31,  35],
    [ 47,  23,  27], [ 35,  19,  19], [ 23,  11,  11], [ 15,   7,   7],
    [219, 195, 187], [203, 179, 167], [191, 163, 155], [175, 151, 139],
    [163, 135, 123], [151, 123, 111], [135, 111,  95], [123,  99,  83],
    [107,  87,  71], [ 95,  75,  59], [ 83,  63,  51], [ 67,  51,  39],
    [ 55,  43,  31], [ 39,  31,  23], [ 27,  19,  15], [ 15,  11,   7],
    [111, 131, 123], [103, 123, 111], [ 95, 115, 103], [ 87, 107,  95],
    [ 79,  99,  87], [ 71,  91,  79], [ 63,  83,  71], [ 55,  75,  63],
    [ 47,  67,  55], [ 43,  59,  47], [ 35,  51,  39], [ 31,  43,  31],
    [ 23,  35,  23], [ 15,  27,  19], [ 11,  19,  11], [  7,  11,   7],
    [255, 243,  27], [239, 223,  23], [219, 203,  19], [203, 183,  15],
    [187, 167,  15], [171, 151,  11], [155, 131,   7], [139, 115,   7],
    [123,  99,   7], [107,  83,   0], [ 91,  71,   0], [ 75,  55,   0],
    [ 59,  43,   0], [ 43,  31,   0], [ 27,  15,   0], [ 11,   7,   0],
    [  0,   0, 255], [ 11,  11, 239], [ 19,  19, 223], [ 27,  27, 207],
    [ 35,  35, 191], [ 43,  43, 175], [ 47,  47, 159], [ 47,  47, 143],
    [ 47,  47, 127], [ 47,  47, 111], [ 47,  47,  95], [ 43,  43,  79],
    [ 35,  35,  63], [ 27,  27,  47], [ 19,  19,  31], [ 11,  11,  15],
    [ 43,   0,   0], [ 59,   0,   0], [ 75,   7,   0], [ 95,   7,   0],
    [111,  15,   0], [127,  23,   7], [147,  31,   7], [163,  39,  11],
    [183,  51,  15], [195,  75,  27], [207,  99,  43], [219, 127,  59],
    [227, 151,  79], [231, 171,  95], [239, 191, 119], [247, 211, 139],
    [167, 123,  59], [183, 155,  55], [199, 195,  55], [231, 227,  87],
    [127, 191, 255], [171, 231, 255], [215, 255, 255], [103,   0,   0],
    [139,   0,   0], [179,   0,   0], [215,   0,   0], [255,   0,   0],
    [255, 243, 147], [255, 247, 199], [255, 255, 255], [159,  91,  83]
];

if (SceneLoader) {
    SceneLoader.RegisterPlugin(new MDLFileLoader());
}
