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
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Animations/animatable';
import { Animation } from '@babylonjs/core/Animations/animation';
import './MDLFileLoader'

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const engine = new Engine(canvas);
var scene = new Scene(engine);

var camera = new FreeCamera('camera1', new Vector3(0, 0, -100), scene);
camera.setTarget(Vector3.Zero());
camera.attachControl(canvas, true);

var light = new HemisphericLight('light1', new Vector3(0, 1, 0), scene);
light.intensity = 1.0;

var time = 0;

//let fileName = 'quaddama.mdl';
let fileName = 'player.mdl';
//let fileName = 'armor.mdl';

SceneLoader.ImportMesh('', '', fileName, scene, function(meshes) {
    let mesh = meshes[0];

    mesh.rotation = new Vector3(-Math.PI/2, 0.0, 0.0);

    // rotate around y-axis
    let rotation = new Animation(
        '',
        'rotation.y',
        30,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CYCLE);
    var keys = [];
    keys.push({ frame: 0, value: 0 });
    keys.push({ frame: 60, value: 2*Math.PI });
    rotation.setKeys(keys);
    mesh.animations.push(rotation);
    scene.beginAnimation(mesh, 0, 120, true);

    let manager = (mesh as Mesh).morphTargetManager;
    scene.registerBeforeRender(function() {
        if (manager.numTargets < 2) {
            manager.getTarget(0).influence = 1;
        }
        else {
            let frameIndex = Math.floor(time % manager.numTargets);
            let alpha = (time % manager.numTargets) - frameIndex;
            time += 0.25;

            for (let i=0; i<manager.numTargets; ++i) {
                manager.getTarget(i).influence = 0;
            }

            manager.getTarget(frameIndex).influence = 1-alpha;
            manager.getTarget((frameIndex+1)%manager.numTargets).influence = alpha;
        }
    });
});

window.addEventListener('resize', function() {
    engine.resize();
});

engine.runRenderLoop(() => {
    scene.render();
});
