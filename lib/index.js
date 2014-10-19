'use strict';

var config = require('../config.json');
var lettujaEngine = require('./lettuja');
var lettujaAdmin = require('./admin');
var fs = require('fs-extra');
var path = require('path');
var chokidar = require('chokidar');

lettujaAdmin.start();
lettujaEngine.run();

var contentWatcher = chokidar.watch(config.contentDirectory, {
  ignored: /[\/\\]\./,
  ignoreInitial: true,
  persistent: true
});

contentWatcher
  .on('all', function (event, path) {
    console.log(event, path);
    if (event === 'error') {
      console.error('Error happened: ', event);
    }
    lettujaEngine.run();
  });
