Babylon.js Quake MDL Viewer
===========================

This repository contains a Babylon.js viewer for Quake MDL files with full support for textures and animations.

Animations are hardcoded in QuakeC so currently we simply dump all frames into a single continuous animation. In the future we could detect standard models such as `player.mdl` and hardcode support for these animations.

Due to copyright restrictions you have to supply your own `.mdl` files.

Live Demo
---------

You can find a [live demo here](http://alas.dk/MDLViewerV2/).

Getting started
---------------

To get started, you first need to install `webpack`, `typescript` and `babylon.js`.

```
npm install webpack webpack-cli webpack-dev-server --save-dev
npm install typescript ts-loader --save-dev
npm install @babylonjs/core@4.1.0-alpha.19 --save-dev 
```

Then you can start a local web sever at `http://localhost:8080/` using the following command.

```
npx webpack-dev-server
```
