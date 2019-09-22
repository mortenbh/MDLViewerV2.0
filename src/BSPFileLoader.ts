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
import { Vector2, Vector3, Vector4 } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { Nullable } from '@babylonjs/core/types';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { IParticleSystem } from '@babylonjs/core/Particles/IParticleSystem';

type DirectoryEntry = {
    offset: number,
    count: number,
};

type Header = {
    planes: DirectoryEntry,
    miptex: DirectoryEntry,
    vertices: DirectoryEntry,
    texinfo: DirectoryEntry,
    faces: DirectoryEntry,
    edges: DirectoryEntry,
    ledges: DirectoryEntry,
};

type Plane = {
    normal: Vector3, // Plane normal
    distance: number, // Signed distance to the origin
    type: number
};

type Face = {
    planeIndex: number,
    side: boolean, // Zero if in front of the plane, one if behind the plane
    ledgeIndex: number, // First edge in the list of edges
    numLedges: number, // Number of edges in the list of edges
    texInfoIndex: number, // Index of the texture information
    lightType: number, // Type of lighting
    baseLight: number, // From 0xFF (dark) to 0x00 (bright)
    light: Vector2, // Two additional light models
    lightMap: number, // Index into light map; otherwise -1
};

type Texinfo = {
    s : Vector4, // xyz+offset
    t : Vector4,// xyz+offset
    miptex : number
    flags : number
};

type Miptex = {
    name: string,
    width: number,
    height: number,
    offsets: Vector4,
};

export class BSPFileLoader implements ISceneLoaderPlugin {
    public name = "bsp";

    public extensions: ISceneLoaderPluginExtensions = {
        ".bsp": { isBinary: true },
    };

    private readHeader(
        reader: BinaryReader): Header
    {
        reader.skipBytes(8); // entities

        let planes: DirectoryEntry = {
            offset: reader.readInt32(),
            count: reader.readInt32()/20, // float3+float+uint
        };

        let miptex: DirectoryEntry = {
            offset: reader.readInt32(),
            count: reader.readInt32(), // char[16]+uint+uint+uint[4]
        };

        let vertices: DirectoryEntry = {
            offset: reader.readInt32(),
            count: reader.readInt32()/12, // float+float+float
        };

        reader.skipBytes(2*8); // vislist+nodes

        let texinfo: DirectoryEntry = {
            offset: reader.readInt32(),
            count: reader.readInt32()/40, // float3+float+float3+float+uint+uint
        };

        let faces: DirectoryEntry = {
            offset: reader.readInt32(),
            count: reader.readInt32()/20, // short+short+int+short+short+char+char+char+char+uint;
        };

        reader.skipBytes(4*8); // lightmaps+clipnodes+leaves+lface

        let edges: DirectoryEntry = {
            offset: reader.readInt32(),
            count: reader.readInt32()/4, // ushort+ushort
        };

        let ledges: DirectoryEntry = {
            offset: reader.readInt32(),
            count: reader.readInt32()/4, // int
        };

        reader.skipBytes(8); // models

        return {
            planes,
            miptex,
            vertices,
            texinfo,
            faces,
            edges,
            ledges,
        };
    }

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
        let reader = new BinaryReader(data);

        // Could handle BSP2 with version number 844124994 (ie. 'BSP2') too.
        if (reader.readInt32() != 29) {
            window.alert("Not a Quake BSP or wrong MDL version.");
            return false;
        }

        let header = this.readHeader(reader);

        reader.seekBytes(header.vertices.offset);
        let vertices = new Array<Vector3>(header.vertices.count);
        for (let i=0; i<header.vertices.count; ++i) {
            vertices[i] = new Vector3(reader.readFloat32(), reader.readFloat32(), reader.readFloat32()).divide(new Vector3(10,10,10));
        }

        reader.seekBytes(header.edges.offset);
        let edges = new Array<Vector2>(header.edges.count);
        for (let i=0; i<header.edges.count; ++i) {
            edges[i] = new Vector2( reader.readUint16(), reader.readUint16() );
        }

        reader.seekBytes(header.texinfo.offset);
        let texinfos = new Array<Texinfo>(header.texinfo.count);
        for (let i=0; i<header.texinfo.count; ++i) {
            let s = new Vector4(reader.readFloat32(), reader.readFloat32(), reader.readFloat32(), reader.readFloat32());
            let t = new Vector4(reader.readFloat32(), reader.readFloat32(), reader.readFloat32(), reader.readFloat32());
            let miptex = reader.readUint32();
            let flags = reader.readUint32();
            texinfos[i] = { s, t, miptex, flags };
        }

        reader.seekBytes(header.miptex.offset);
        header.miptex.count = reader.readUint32();
        let miptexOffsets = reader.readUint32Array(header.miptex.count);
        let miptexs = new Array<Miptex>(header.miptex.count);
        for (let i=0; i<header.miptex.count; ++i) {
            reader.seekBytes(header.miptex.offset + miptexOffsets[i]);
            let array = reader.readUint8Array(16);

            // Remove everything after null byte.
            let index = array.findIndex((v) => { return v==0; });
            if (index >= 0) {
                array = array.slice(0, index);
            }

            let name = String.fromCharCode.apply(null, array)
            let width = reader.readUint32();
            let height = reader.readUint32();
            let offsets = new Vector4(reader.readUint32(), reader.readUint32(), reader.readUint32(), reader.readUint32());
            miptexs[i] = { name, width, height, offsets };
        }

        let multiMaterial = new MultiMaterial('multiMaterial', scene);
        for (let i=0; i<header.miptex.count; ++i) {
            reader.seekBytes(header.miptex.offset + miptexOffsets[i] + miptexs[i].offsets.x);

            let width = miptexs[i].width;
            let height = miptexs[i].height;

            let data = new Uint8Array(3*width*height);
            for (let j=0; j<width*height; ++j) {
                let color = colorMap[reader.readUint8()];
                data[3*j+0] = color[0];
                data[3*j+1] = color[1];
                data[3*j+2] = color[2];
            }

            // let samplingMode = RawTexture.TRILINEAR_SAMPLINGMODE;
            // let samplingMode = RawTexture.LINEAR_LINEAR;
            // let samplingMode = RawTexture.LINEAR_NEAREST;
            // let samplingMode = RawTexture.NEAREST_LINEAR;
            let samplingMode = RawTexture.NEAREST_NEAREST;

            let texture = new RawTexture(
                data,
                width,
                height,
                Engine.TEXTUREFORMAT_RGB,
                scene,
                false, // generate mip maps
                true, // invertY
                samplingMode,
                Engine.TEXTURETYPE_UNSIGNED_BYTE);

            texture.wrapU = RawTexture.WRAP_ADDRESSMODE;
            texture.wrapV = RawTexture.WRAP_ADDRESSMODE;
            texture.wrapR = RawTexture.WRAP_ADDRESSMODE;

            let material = new StandardMaterial(miptexs[i].name, scene);
            material.diffuseTexture = texture;
            multiMaterial.subMaterials.push(material);
        }

        // A list of indices into the edge array defining a face.
        // The sign of each index defines the orientation of the edge. If the sign is
        // positive the edge is walked in clockwise fashion from vertex0 to vertex1.
        // Otherwise, it is walked in the counter-clockwise orientation.
        reader.seekBytes(header.ledges.offset);
        let ledges = new Int32Array(header.ledges.count);
        for (let i=0; i<header.ledges.count; ++i) {
            ledges[i] = reader.readInt32();
        }

        reader.seekBytes(header.planes.offset);
        let planes = new Array<Plane>(header.planes.count);
        for (let i=0; i<header.planes.count; ++i) {
            let normal = new Vector3(reader.readFloat32(), reader.readFloat32(), reader.readFloat32());
            let distance = reader.readFloat32();
            let type = reader.readUint32();
            planes[i] = { normal, distance, type };
        }

        let numTriangles = 0;
        reader.seekBytes(header.faces.offset);
        let faces = new Array<Face>(header.faces.count);
        let faceOffsets = new Uint32Array(header.faces.count+1);
        for (let i=0; i<header.faces.count; ++i) {
            let planeIndex = reader.readUint16();
            let side: boolean = !!reader.readUint16();
            let ledgeIndex = reader.readInt32();
            let numLedges = reader.readUint16();
            let texInfoIndex = reader.readInt16();
            let lightType = reader.readUint8();
            let baseLight = reader.readUint8();
            let light = new Vector2(reader.readUint8(), reader.readUint8());
            let lightMap = reader.readUint32();
            faces[i] = { planeIndex, side, ledgeIndex, numLedges, texInfoIndex, lightType, baseLight, light, lightMap };

            numTriangles += (numLedges - 2);
            faceOffsets[i+1] = numTriangles;
        }

        let dot = (a : Vector4, b : Vector4) => { return a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w; };
        let vertexData = new VertexData();
        vertexData.positions = new Float32Array(9*numTriangles);
        vertexData.uvs = new Float32Array(6*numTriangles);
        vertexData.indices = new Uint32Array(3*numTriangles);

        for (let i=0; i<header.faces.count; ++i) {
            let start = faces[i].ledgeIndex;
            let end = start + faces[i].numLedges;
            let texinfo = texinfos[faces[i].texInfoIndex];
            let miptex = miptexs[texinfo.miptex];

            // Extract polygon
            let polygon = [];
            for (let j=start; j<end; ++j) {
                let edgeIndex = ledges[j];
                let edge : Vector2 = edges[Math.abs(edgeIndex)];
                polygon.push(edgeIndex < 0 ? edge.x : edge.y);
            }

            // Triangulate polygon
            let numTriangles = polygon.length - 2;
            for (let j=0; j<numTriangles; ++j) {
                let index = faceOffsets[i] + j;
                let t = [ polygon[0], polygon[j+1], polygon[j+2] ];
                for (let k=0; k<3; ++k) {
                    let v = new Vector4(vertices[t[k]].x, vertices[t[k]].y, vertices[t[k]].z, 1);
                    vertexData.positions[9*index + (3*k+0)] = v.x;
                    vertexData.positions[9*index + (3*k+1)] = v.y;
                    vertexData.positions[9*index + (3*k+2)] = v.z;
                    v = v.multiply(new Vector4(10,10,10, 1));
                    vertexData.uvs[6*index + (2*k+0)] = +dot(v, texinfo.s) / miptex.width;
                    vertexData.uvs[6*index + (2*k+1)] = -dot(v, texinfo.t) / miptex.height;
                    vertexData.indices[3*index + k] = 3*index + k;
                }
            }
        }

        let mesh = new Mesh('bsp', scene);
        vertexData.applyToMesh(mesh);
        mesh.material = multiMaterial;

        // FIXME per face might be too expensive; group submeshes together by texture
        // https://doc.babylonjs.com/how_to/multi_materials
        for (let i=0; i<header.faces.count; ++i) {
            let texinfo = texinfos[faces[i].texInfoIndex];
            let start = faceOffsets[i];
            let end = faceOffsets[i+1];
            let num = end - start;
            let verticesStart = 9*start;
            let verticesCount = 9*num;
            let indicesStart = 3*start;
            let indicesCount = 3*num;
            let subMesh = new SubMesh(texinfo.miptex, verticesStart, verticesCount, indicesStart, indicesCount, mesh);
            mesh.subMeshes.push(subMesh);
        }

        meshes.push(mesh);

        // for (let i=0; i<header.numVertices; ++i) {
        //     let v = new Vector3(positions[3*i+0], positions[3*i+1], positions[3*i+2]);
        //     v = v.divide(new Vector3(1000,1000,1000));
        //     // document.write('('+positions[3*i+0]+','+positions[3*i+1]+','+positions[3*i+2]+')');
        //     document.write(''+v);
        // }

        // for (let i=0; i<header.edges.count; ++i) {
        //     let myPoints = [];
        //     let v0 = new Vector3(positions[3*edges[i].x+0], positions[3*edges[i].x+1], positions[3*edges[i].x+2]);
        //     let v1 = new Vector3(positions[3*edges[i].y+0], positions[3*edges[i].y+1], positions[3*edges[i].y+2]);
        //     v0 = v0.divide(new Vector3(10,10,10));
        //     v1 = v1.divide(new Vector3(10,10,10));
        //     myPoints.push(v0);
        //     myPoints.push(v1);
        //     meshes.push(MeshBuilder.CreateLines('', {points: myPoints}, scene));
        // }

        return true;
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
        return this.importMesh(null, scene, data, rootUrl, null, null, null);
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
    private _littleEndian: boolean = true;

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

    public readInt16(): number {
        const value = this._dataView.getInt16(this._byteOffset, this._littleEndian);
        this._byteOffset += 2;
        return value;
    }

    public readUint16(): number {
        const value = this._dataView.getUint16(this._byteOffset, this._littleEndian);
        this._byteOffset += 2;
        return value;
    }

    public readInt32(): number {
        const value = this._dataView.getInt32(this._byteOffset, this._littleEndian);
        this._byteOffset += 4;
        return value;
    }

    public readUint32(): number {
        const value = this._dataView.getUint32(this._byteOffset, this._littleEndian);
        this._byteOffset += 4;
        return value;
    }

    public readFloat32(): number {
        const value = this._dataView.getFloat32(this._byteOffset, this._littleEndian);
        this._byteOffset += 4;
        return value;
    }

    public readUint8Array(length: number): Uint8Array {
        const value = new Uint8Array(this._arrayBuffer, this._byteOffset, length);
        this._byteOffset += length;
        return value;
    }

    public readUint32Array(length: number): Uint32Array {
        const value = new Uint32Array(this._arrayBuffer, this._byteOffset, length);
        this._byteOffset += 4*length;
        return value;
    }

    public skipBytes(length: number): void {
        this._byteOffset += length;
    }

    public seekBytes(offset: number): void {
        this._byteOffset = offset;
    }
}

if (SceneLoader) {
    SceneLoader.RegisterPlugin(new BSPFileLoader());
}

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
