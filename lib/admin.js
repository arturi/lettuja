const conf = require('../config.json');
const environments = require('../environments.json');
const path = require('path');
const compression = require('compression');
const session = require('express-session');
const pify = require('pify');
const fs = require('fs-extra');
const gm = require('gm');
const promiseFs = pify(fs);
const moment = require('moment');
const multer = require('multer');
const upload = multer({ dest: './uploads/'});
const express = require('express');
const exphbs = require('express-handlebars');

const app = express();

app.set('views', path.join(__dirname, 'admin'));
app.engine('handlebars', exphbs({
  defaultLayout: 'main',
  layoutsDir: path.join(__dirname, 'admin/layouts')
}));
app.set('view engine', 'handlebars');

app.use('/', express.static(conf.siteDir));
app.use('/admin', express.static(path.join(__dirname, 'admin/static')));

function resizeAndMove(folder, imgSize, file) {
  let originalExtension = path.extname(file.originalname);
  let originalName = file.originalname.substr(0, file.originalname.lastIndexOf('.'));

  // if file is an image, resize it, then move
  if (file.mimetype === 'image/jpeg'
      || file.mimetype === 'image/png'
      || file.mimetype === 'image/gif'
      || file.mimetype === 'image/webp') {

    let newName = originalName.replace(/\W+/g, '-').toLowerCase() + Date.now() + originalExtension.toLowerCase();
    let dstImgPath = conf.outputMediaDirectory + '/' + folder + '/' + newName;
    let imgPath = '/media/' + folder + '/' + newName;

    return new Promise(function (resolve, reject) {
      gm(file.path).resize(imgSize, null, '>').write(file.path, function(err) {
        if (err) reject(err);
        fs.move(file.path, dstImgPath, function(err) {
          if (err) reject(err);
          resolve(imgPath);
        });
      });
    });

  // otherwise just move
  } else {
    let dstImgPath = conf.outputMediaDirectory + '/' + folder + '/' + originalName + originalExtension;
    let imgPath = '/media/' + folder + '/' + originalName + originalExtension;

    return new Promise(function (resolve, reject) {
      fs.move(file.path, dstImgPath, function(err) {
        if (err) reject(err);
        resolve(imgPath);
      });
    });
  }
}

app.get('/admin', function (req, res) {
  let date = moment().format('YYYY/MM');
  res.render('admin', { date: date, defaultImageSize: conf.imageSize });
});

app.get('/admin/edit/:document', function (req, res) {
  let document = req.params.document;
  fs.readFile(environments.russian.src + '/' + document + conf.contentFileExt, 'utf-8', function (err, file) {
    if (err) console.log(err);
    res.render('edit', { content: file});
  });
});

app.post('/admin/upload', upload.array('files', 12), function (req, res) {
  // Resize the images to the selected size
  // add move them to the selected folder
  Promise.all(req.files.map(function (file) {
    let folder = req.body.folder;
    let imgSize = req.body.imgSize;
    let filePath = file.path;
    let originalName = file.originalname;

    return resizeAndMove(folder, imgSize, file)
      .then(function (data) {
        return data;
      });
  }))
  .catch(function (err) {
    console.log('Image resize failed: ', err);
  })
  .then(function (files) {
    // send links to the parsed files back to the page
    res.json(files);
  });

});

function start(port) {
  // 3200
  app.listen(port);
}

// start(3200);

exports.start = start;
