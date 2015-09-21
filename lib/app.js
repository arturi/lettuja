'use strict';

const conf = require('../config.json');
const environments = require('../environments.json');
const util = require('./util.js');
const lettujaEngine = require('./lettuja.js');
const lettujaAdmin = require('./admin.js');
const chokidar = require('chokidar');

let contentWatcher = chokidar.watch(conf.contentDir, {
  ignored: /[\/\\]\./,
  ignoreInitial: true,
  persistent: true
});

contentWatcher.on('all', function (event, filePath) {
  console.log(event, filePath);

  if (event === 'error') {
    console.error('Error happened: ', event);
  }

  if ( util.isFilePathCorrect(filePath) ) {
    lettujaEngine.run();
  } else {
    console.log('incorrect file extension');
  }
});

console.log('firing up the admin');
lettujaAdmin.start(conf.port);

console.log('running the engine');
lettujaEngine.run('regenerateAll');
