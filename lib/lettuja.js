'use strict';

var config = require('../config.json');
var fs = require('fs-extra');
var glob = require('glob');
var path = require('path');
var async = require('async');
var handlebars = require('handlebars');
var marked = require('marked');
var richtypo = require('richtypo');
var moment = require('moment');
var util = require('./utilities');

var templates = {};
var documentTree = [];
var documentCollection = [];
var documentCollectionLength = [];

function compileAllTemplates(callback) {
  config.templateDirectory = path.resolve(config.templateDirectory) + '/';
  fs.readdir(config.templateDirectory, function (err, templateList) {
    async.each(templateList, (function (templateFileName, callback) {
      if (path.extname(templateFileName) === '.html') {
        if (templateFileName.substring(0, 1) === '_') {
          fs.readFile(config.templateDirectory + templateFileName, 'utf-8', function (err, templateContent) {
            var partialName = path.basename(templateFileName.replace('_', ''), '.html');
            handlebars.registerPartial(partialName, templateContent);
            callback();
          });
        } else {
          fs.readFile(config.templateDirectory + templateFileName, 'utf-8', function (err, templateContent) {
            templates[path.basename(templateFileName, '.html')] = handlebars.compile(templateContent);
            callback();
          });
        }
      } else {
        callback();
      }
    }), function() {
      callback();
    });
  });
}

function getDocumentTree(callback) {
  glob(config.contentDirectoryLang + '**/*.' + config.contentFileExtension, null, function (err, files) {
    files.forEach(function(file) {
      var dotCount = file.match(/\./g);
      if (dotCount.length === 1) {
        documentTree.push(file);
      }
    });
    callback();
  });
}

function createDocumentCollection(lang, documentTree, callback) {
  async.each(documentTree, (function (filePath, callback) {
    fs.readFile(filePath, 'utf-8', function (err, fileContent) {
      var metaAndBody = getMetaAndBody(fileContent);
      parseMeta(metaAndBody[0], filePath, function (err, metaParsed) {
        documentCollection.push(metaParsed);
        callback();
      });
    });
  }), function () {
    documentCollection.sort(util.sortByDate).reverse();
    documentCollectionLength[0] = documentCollection.length;
    callback();
  });
}

function generateDocument(lang, filePath, callback) {
  var slug = path.basename(filePath, '.md');
  if (util.findTraverse(config.unforgivableFileNames, slug)) {
    console.log(slug + ' is a reserved name, please rename this document');
    callback();
  } else {
    fs.readFile(filePath, 'utf-8', function (err, fileContent) {
      if (err) { console.log(err); }
      var metaAndBody = getMetaAndBody(fileContent);
      parseMetaAndBody(metaAndBody[0], metaAndBody[1], filePath, function (err, metaAndBodyParsed) {
        var isSingle, outputContent, outputPath, template, templateContent;
        if (err) { console.log(err); }
        if (templates[metaAndBodyParsed.template]) {
          template = metaAndBodyParsed.template;
          isSingle = false;
        } else {
          template = 'single';
          isSingle = true;
        }
        templateContent = {
          post: metaAndBodyParsed,
          strings: config['strings'][lang],
          lang: lang,
          slug: slug,
          langPath: config.langPath,
          template: template,
          rawTitle: metaAndBodyParsed.rawTitle,
          title: metaAndBodyParsed.title,
          isSingle: isSingle
        };
        if (slug === 'index') {
          outputPath = config.outputDirectoryLang + slug + '.html';
        } else if (metaAndBodyParsed.type === 'draft') {
          outputPath = config.outputDirectoryLang + 'drafts/' + slug + '/index.html';
        } else {
          outputPath = config.outputDirectoryLang + slug + '/index.html';
        }
        outputContent = templates[template](templateContent);
        fs.outputFile(outputPath, outputContent, function (err) {
          callback(err);
        });
      });
    });
  }
}

function generateAllDocuments(lang, callback) {
  async.each(documentCollection, (function (doc, callback) {
    generateDocument(lang, doc.filename, function (err) {
      if (err) { return next(err); }
      callback();
    });
  }), function (err) {
    if (err) console.log(err);
    console.log(lang + ' documents generated: ' + documentCollection.length);
    callback();
  });
}

function generateDocumentList(lang, recentDocuments, limit, template, callback) {
  var recentContent = [];
  var recentCounter = 0;
  async.eachSeries(recentDocuments, (function (doc, callback) {
    if (recentCounter < limit) {
      fs.readFile(doc.filename, 'utf-8', function (err, fileContent) {
        if (err) console.log(err);
        var metaAndBody = getMetaAndBody(fileContent);
        if (template === 'archive') {
          parseMeta(metaAndBody[0], doc.filename, function (err, metaParsed) {
            if (err) console.log(err);
            if (metaParsed.type === 'page' || metaParsed.type === 'draft') {
              callback();
            } else {
              recentCounter++;
              recentContent.push(metaParsed);
              callback();
            }
          });
        } else {
          parseMetaAndBody(metaAndBody[0], metaAndBody[1],
            doc.filename, function(err, metaAndBodyParsed) {
            if (err) console.log(err);
            if (metaAndBodyParsed.type === 'page' || metaAndBodyParsed.type === 'draft') {
              callback();
            } else {
              recentCounter++;
              recentContent.push(metaAndBodyParsed);
              callback();
            }
          });
        }
      });
    } else {
      callback();
    }
  }), function (err) {
    var outputContent, outputPath, templateContent, title;
    if (err) console.log(err);
    switch (template) {
      case 'archive':
        title = config['strings'][lang].archive;
        outputPath = 'archive/index.html';
        break;
      case 'blog':
        title = config['strings'][lang].blogTitle;
        outputPath = 'blog/index.html';
        break;
      case 'feed':
        title = config['strings'][lang].blog;
        outputPath = 'blog-feed.xml';
    }
    templateContent = {
      posts: recentContent,
      strings: config['strings'][lang],
      lang: lang,
      langPath: config.langPath,
      template: template,
      title: title,
      updated: recentContent[0].pubDate
    };
    outputContent = templates[template](templateContent);
    fs.outputFile(config.outputDirectoryLang + outputPath, outputContent, function(err) {
      console.log(lang + ' ' + template + ' generated' );
      callback(err);
    });
  });
}

function getMetaAndBody(fileContent) {
  // Split fileContent into two using empty line as a divider:
  // first part is meta data, second part is body
  var fileMetaAndBody = util.splitTwo(fileContent, '\n\n');
  var fileMeta = fileMetaAndBody[0].split('\n');
  var fileBody = fileMetaAndBody[1];
  return [fileMeta, fileBody];
}

function parseMetaAndBody(fileMeta, fileBody, fileName, callback) {
  parseMeta(fileMeta, fileName, function(err, result) {
    var metaAndBodyParsed = result;
    metaAndBodyParsed.body = richtypo.rich(marked(fileBody));
    metaAndBodyParsed.excerpt = util.splitTwo(metaAndBodyParsed.body, config.cutString);
    metaAndBodyParsed.excerpt = metaAndBodyParsed.excerpt[0];
    callback(err, metaAndBodyParsed);
  });
}

function parseMeta(fileMeta, fileName, callback) {
  var metaParsed = {};
  async.each(fileMeta, (function(metaItem, callback) {
    var metaDataKeyValue = util.splitTwo(metaItem, ':');
    var metaDataKey = metaDataKeyValue[0];
    var metaDataValue = metaDataKeyValue[1];
    metaParsed[metaDataKey.toLowerCase()] = metaDataValue.trim();
    callback();
  }), function (err) {
    // If the date is not specified, set it to current
    if (metaParsed.date === undefined) {
      metaParsed.date = moment().format('YYYY-MM-DD HH:mm');
    }
    metaParsed.rawTitle = metaParsed.title;
    metaParsed.title = richtypo.title(metaParsed.title);
    metaParsed.unixDate = moment(metaParsed.date, 'YYYY-MM-DD HH:mm').unix();
    metaParsed.stringDate = moment(metaParsed.date, 'YYYY-MM-DD HH:mm').format('D MMMM YYYY');
    metaParsed.pubDate = moment(metaParsed.date, 'YYYY-MM-DD HH:mm').format();
    metaParsed.filename = fileName;
    metaParsed.slug = path.basename(fileName, '.md');
    metaParsed.absoluteLink = config.siteURL + config.langPath + metaParsed.slug + '/';
    metaParsed.relativeLink = config.langPath + metaParsed.slug + '/';
    callback(err, metaParsed);
  });
}

// Setting global language, options and paths
function setup(lang, callback) {
  util.fixMarkdown(marked);
  richtypo.lang(lang);
  moment.locale(lang);
  marked.setOptions({ gfm: true, breaks: true });
  config.contentDirectoryLang = path.resolve(config.contentDirectory) +
      ('/' + lang + '/');

  // If the defaultLang is set in config, then place its content in root dir
  // and all the other languages in subdirs.
  // Otherwise just put each language in it’s own subdirectory
  if (config.defaultLang && config.defaultLang === lang) {
    config.outputDirectoryLang = path.resolve(config.outputDirectory) + '/';
    config.langPath = '/';
  } else {
    config.outputDirectoryLang = path.resolve(config.outputDirectory) +
        ('/' + lang + '/');
    config.langPath = '/' + lang + '/';
  }

  callback();
}

function generateAll(lang, callback) {
  async.series([
    compileAllTemplates,
    setup.bind(null, lang),
    getDocumentTree,
    createDocumentCollection.bind(null, lang, documentTree),
    generateDocumentList.bind(null, lang, documentCollection, config.postsOnIndex, 'blog'),
    generateDocumentList.bind(null, lang, documentCollection, documentCollectionLength, 'archive'),
    generateDocumentList.bind(null, lang, documentCollection, config.postsOnFeed, 'feed'),
    generateAllDocuments.bind(null, lang)
  ], function(err) {
    documentTree = [];
    documentCollection = [];
    callback();
  });
}

function runMultilang(callback) {
  var startTime = new Date().getTime();
  var specifiedDocument = process.argv[2];

  async.eachSeries(config.languages, function (lang, callback) {
    generateAll(lang, function () {
      callback();
    });
  }, function () {
    var endTime = new Date() - startTime;
    console.log('all done in ' + endTime / 1000 + ' seconds, on ' + moment().format('HH:mm:ss YYYY-MM-DD'));
    if (callback) {
      callback();
    }
  });
}

// function run(lang) {
//   var startTime = new Date().getTime();
//   generateAll(lang, function () {
//     var endTime = new Date() - startTime;
//     console.log('all done in ' + endTime / 1000 + ' seconds');
//   });
// }

// If the language is specified from launch command, generate that language
// otherwise generate all languages
// var specifiedLang = process.argv[2];
// if (specifiedLang != null) {
//   run(specifiedLang);
// } else {
//   runMultilang();
// }

exports.run = runMultilang;
