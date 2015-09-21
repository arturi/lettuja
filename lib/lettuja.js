'use strict';

const conf = require('../config.json');
const environments = require('../environments.json');
const util = require('./util.js');
const path = require('path');

const pify = require('pify');
const glob = require('glob');
const fs = require('fs-extra');
const promiseFs = pify.all(fs);
const promiseGlob = pify(glob);

const fm = require('front-matter');
const md = require('markdown-it')({
  html: true,
  breaks: true
});
const richtypo = require('richtypo');
const handlebars = require('handlebars');
const moment = require('moment');

const minify = require('html-minifier').minify;
// const co = require('co');

async function compileTemplates(environment) {
  let templatePathList = await promiseGlob(environment.views + '/**/*' + conf.templateFileExt);

  let templates = {};
  for (let templatePath of templatePathList) {
    let templateContent = await promiseFs.readFile(templatePath, 'utf-8');
    let templateFileName = path.basename(templatePath, conf.templateFileExt);
    let templateName = templateFileName.replace('_', '');

    // register templates that start with _ as partials
    if (templateFileName.substring(0, 1) === '_') {
      handlebars.registerPartial(templateName, templateContent);
    } else {
      templates[templateName] = handlebars.compile(templateContent);
    }
  }
  return templates;
}

function getAllFiles(environment) {
  return promiseGlob(environment.src + '/**/*' + conf.contentFileExt);
}

function parseMeta(fileContent, environment) {
  let parsedMeta = fileContent.meta;

  // if date is unspecified, set to current
  if (parsedMeta.datePublished === undefined) {
    parsedMeta.datePublished = moment().format('YYYY-MM-DD HH:mm');
  }

  // if template is unspecified, set to single
  if (parsedMeta.template === undefined) {
    if (parsedMeta.type === 'page') {
      parsedMeta.template = 'page';
    } else {
      parsedMeta.template = 'single';
    }
  }

  parsedMeta.rawTitle = parsedMeta.title;
  parsedMeta.title = richtypo.title(parsedMeta.rawTitle);
  parsedMeta.unixDate = moment(parsedMeta.datePublished, 'YYYY-MM-DD HH:mm').unix();
  parsedMeta.stringDate = moment(parsedMeta.datePublished, 'YYYY-MM-DD HH:mm').format('D MMMM YYYY');
  parsedMeta.pubDate = moment(parsedMeta.datePublished, 'YYYY-MM-DD HH:mm').format();
  parsedMeta.lastModified = fileContent.stat.mtime.getTime();
  parsedMeta.filePath = fileContent.path;
  parsedMeta.slug = path.basename(fileContent.path, conf.contentFileExt);
  parsedMeta.absoluteLink = conf.siteURL + environment.outPath + '/' + parsedMeta.slug + '/';
  parsedMeta.relativeLink = environment.outPath + '/' + parsedMeta.slug + '/';
  parsedMeta.lang = environment.lang;

  return parsedMeta;
}

async function parseFile(filePath) {
  let rawFileContent = await promiseFs.readFile(filePath, 'utf-8');
  let fileStat = await promiseFs.stat(filePath);
  let metaAndBody = fm(rawFileContent);
  let fileContent = {};

  fileContent.meta = metaAndBody.attributes;
  fileContent.body = metaAndBody.body;
  fileContent.path = filePath;
  fileContent.stat = fileStat;
  return fileContent;
}

function parseBody(body) {
  let parsedBody;
  parsedBody = md.render(body); // markdown 
  parsedBody = richtypo.rich(parsedBody); // typography

  let parsedBodyAndExcerpt = {
    full: parsedBody,
    excerpt: util.splitTwo(parsedBody, conf.cutString).shift()
  };

  return parsedBodyAndExcerpt;
}

async function makeCollection(src, environment) {
  let collection = [];
  for (let filePath of src) {
    let fileContent = await parseFile(filePath);
    let fileMeta = await parseMeta(fileContent, environment);
    collection.push(fileMeta);
  }
  return collection.sort(util.sortByDate).reverse();
}

async function generateOneDocument(docMeta, templates, environment) {
  let slug = path.basename(docMeta.filePath, conf.contentFileExt);
  let fileContent = await parseFile(docMeta.filePath);
  docMeta.body = parseBody(fileContent.body);
  docMeta.isSingle = true;
  docMeta.isBlog = environment.isBlog;
  docMeta.strings = conf.strings[environment.lang];
  docMeta.navPath = environment.outPath;

  let html = templates[docMeta.template](docMeta);
  // html = minify(html, {
  //   collapseWhitespace: true
  // });

  let htmlPath = (docMeta.template === 'index') ?
      path.join(environment.outDir, environment.outPath, 'index.html') :
      path.join(environment.outDir, environment.outPath, '/' + slug + '/', 'index.html');

  if (util.findTraverse(conf.unforgivableFileNames, slug)) {
    console.log(slug + ' is a reserved name, please rename this document');
    return;
  }

  return promiseFs.outputFile(htmlPath, html);
}

async function generateAllDocuments(collection, templates, environment) {
  for (let item of collection) {
    await generateOneDocument(item, templates, environment);
  }
}

async function generateList(newCollection, templates, environment, type, limit) {
  // for archive use all documents in collection, otherwise limit them
  let documentList = (type === 'archive') ? newCollection : newCollection.slice(0, limit);

  // filter unpublished posts and all pages
  function isDraftOrPage(element) {
    if (element.type !== 'page' && element.type !== 'draft' && element.published) {
      return element;
    }
  }

  documentList = documentList.filter(isDraftOrPage);

  let documentListWithBody = [];
  for (let docMeta of documentList) {
    let fileContent = await parseFile(docMeta.filePath);
    docMeta.body = parseBody(fileContent.body);
    documentListWithBody.push(docMeta);
  }

  let title, outputPath;
  switch (type) {
    case 'archive':
      title = conf.strings[environment.lang].archive;
      outputPath = 'archive/index.html';
      break;
    case 'blog':
      title = conf.strings[environment.lang].blogTitle;
      outputPath = 'blog/index.html';
      break;
    case 'feed':
      title = conf.strings[environment.lang].blog;
      outputPath = 'blog-feed.xml';
  }

  let data = {
    documentList: documentListWithBody,
    title: title,
    environment: environment,
    updated: documentListWithBody[0].pubDate,
    strings: conf.strings[environment.lang],
    navPath: environment.outPath,
    isBlog: environment.isBlog
  };

  let html = templates[type](data);

  return promiseFs.outputFile(path.join(environment.outDir, environment.outPath, outputPath), html);
}

function generateAllLists(newCollection, templates, environment) {
  return Promise.all([
    generateList(newCollection, templates, environment, 'archive'),
    generateList(newCollection, templates, environment, 'blog', conf.postsOnFeed),
    generateList(newCollection, templates, environment, 'feed', conf.postsOnBlogIndex)
  ]);
}

function saveCollection(newCollection, environment) {
  let collectionPath = path.join(environment.outDir, environment.outPath, 'collection.json');
  newCollection = JSON.stringify(newCollection);
  return promiseFs.outputFile(collectionPath, newCollection);
}

async function generate(environment) {
  let fileList = await getAllFiles(environment);
  let newCollection = await makeCollection(fileList, environment);
  let templates = await compileTemplates(environment);
  let modifiedCollection = newCollection;

  await saveCollection(newCollection, environment);
  await generateAllDocuments(modifiedCollection, templates, environment);

  if ( environment.isBlog ) {
    await generateAllLists(newCollection, templates, environment);
  }
  console.log(environment.name + ' generated');
}

async function run(option) {
  try {
    if (option === 'regenerateAll') {
      conf.regenerateAll = true;
    }

    let startTime = new Date().getTime();

    for(let env in environments) {
      let environment = environments[env];
      environment.name = env;
      moment.locale(environment.lang);
      richtypo.lang(environment.lang);

      await generate(environment);
    }

    let endTime = new Date() - startTime;
    console.log(`all done in ${endTime / 1000} seconds, on ${moment().format('HH:mm:ss YYYY-MM-DD')}`);
  } catch (err) {
    onerror(err);
  }
}

function onerror(err) {
  console.error(err.stack);
}

// run('regenerateAll');

exports.run = run;
