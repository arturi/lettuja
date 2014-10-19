'use strict';

var config = require('../config.json');
var lettujaEngine = require('./lettuja');
var moment = require('moment');
var compression = require('compression');
var fs = require('fs-extra');
var multer = require('multer');
var gm = require('gm');
var express = require('express');
var session = require('express-session');
var exphbs = require('express-handlebars');
var app = express();

app.set('views', __dirname + '/views/');
app.engine('handlebars', exphbs({defaultLayout: 'main', layoutsDir: __dirname + '/views/layouts/'}));
app.set('view engine', 'handlebars');

app.use(compression());
app.use(session({
  secret: 'thatis50053YEAH0',
  saveUninitialized: true,
  resave: true
}));
app.use(express.static(config.outputDirectory, { maxAge: 86400000 }));

// Handle file uploads
app.use(multer({
  dest: config.tempUploads,
  rename: function (fieldname, filename) {
    return filename.replace(/\W+/g, '-').toLowerCase() + Date.now();
  }
}));

app.post('/upload', function uploadImages(req, res) {
  var imgFolder = req.body.folder;
  var fileUploadPath = req.files.image.path;
  var dstImgPath = config.outputMediaDirectory +
      '/' + imgFolder + '/' +
      (req.files.image.name).toLowerCase();
  var imgPath = '/media/' + imgFolder + '/' +
      (req.files.image.name).toLowerCase();
  var markdownImgPath = '![image](' + imgPath + ')';

  gm(fileUploadPath)
  .resize(config.imageSize)
  .write(fileUploadPath, function (err) {
    if (err) {
      console.log(err);
    }
    fs.move(fileUploadPath, dstImgPath, function() {
      res.send({ imagePath: imgPath, markdownImagePath: markdownImgPath });
    });
  });
});

// Handle login
function checkAuth(req, res, next) {
  if (!req.session.user_id) {
    res.redirect('/login');
  } else {
    next();
  }
}

app.get('/login', function (req, res) {
  res.render('login');
});

app.post('/login', function (req, res) {
  var post = req.body;
  if (post.password === config.adminCredentials.password) {
    req.session.user_id = 'admin';
    res.redirect('/admin');
  } else {
    res.send('Bad user/pass');
  }
});

app.get('/logout', function (req, res) {
  delete req.session.user_id;
  res.redirect('/login');
});

app.get('/admin', checkAuth, function (req, res) {
  var date = moment().format('YYYY/MM');
  res.render('admin', {date: date});
});

app.post('/generate', function (req, res) {
  lettujaEngine.run();
});

function start() {
  app.listen(3060);
}

exports.start = start;
