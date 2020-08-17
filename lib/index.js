const conf = require('../config.json')
const util = require('./util.js')
const lettujaEngine = require('./lettuja.js')
const lettujaAdmin = require('./admin.js')
const chokidar = require('chokidar')

const contentWatcher = chokidar.watch(conf.contentDir, {
  ignored: /[/\\]\./,
  ignoreInitial: true,
  persistent: true
})

contentWatcher.on('all', function (event, filePath) {
  console.log(event, filePath)

  if (event === 'error') {
    console.error('Error happened: ', event)
  }

  if (util.isFilePathCorrect(filePath)) {
    lettujaEngine.run()
  } else {
    console.log('incorrect file extension')
  }
})

console.log()
console.log('Firing up Lettuja media admin at http://localhost:' + conf.port)
lettujaAdmin.start(conf.port)

console.log('Running the engine!')
lettujaEngine.run('regenerateAll')
