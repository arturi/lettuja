const conf = require('../config.json');
const environments = require('../environments.json');

const util = require('./util.js');
const path = require('path');
const glob = require('glob-promise');
const fs = require('fs-promise');
const matter = require('gray-matter');
const richtypo = require('richtypo');
const handlebars = require('handlebars');
const moment = require('moment');
const _ = require('lodash');
const md = require('markdown-it')({
  html: true,
  breaks: true
})

md.use(require('markdown-it-anchor'), {
  level: 1,
  permalink: true,
  permalinkSymbol: '',
  permalinkClass: 'header-anchor',
  permalinkBefore: true,
  slugify: util.slugifyHeaderId
});
// const fm = require('front-matter');
// const minify = require('html-minifier').minify;

async function compileTemplates(environment) {
  let templatePathList = await glob(environment.views + '/**/*' + conf.templateFileExt);

  let templates = {};
  for (let templatePath of templatePathList) {
    // templatePathList.map(templatePath => fs.readFile(templatePath, 'utf-8'));

    let templateContent = await fs.readFile(templatePath, 'utf-8');
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
  return glob(environment.src + '/**/*' + conf.contentFileExt);
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
  parsedMeta.unixDate = moment.utc(parsedMeta.datePublished, 'YYYY-MM-DD HH:mm').unix();
  parsedMeta.stringDate = moment.utc(parsedMeta.datePublished, 'YYYY-MM-DD HH:mm').format('D MMMM YYYY');
  parsedMeta.pubDate = moment.utc(parsedMeta.datePublished, 'YYYY-MM-DD HH:mm').format('YYYY-MM-DDTHH:mm:ssZ');
  parsedMeta.lastModified = fileContent.stat.mtime.getTime();
  parsedMeta.filePath = fileContent.path;
  parsedMeta.fileRelativePath = path.dirname(parsedMeta.filePath.split(environment.src)[1]);
  parsedMeta.slug = path.basename(fileContent.path, conf.contentFileExt);
  parsedMeta.lang = environment.lang;

  if (environment.permalinks === 'retainStructure') {
    parsedMeta.absoluteLink = `${conf.siteURL}${environment.outPath}/${parsedMeta.fileRelativePath}/${parsedMeta.slug}/`
    parsedMeta.relativeLink = `${environment.outPath}/${parsedMeta.fileRelativePath}/${parsedMeta.slug}/`
  } else {
    parsedMeta.absoluteLink = `${conf.siteURL}${environment.outPath}/${parsedMeta.slug}/`
    parsedMeta.relativeLink = `${environment.outPath}/${parsedMeta.slug}/`
  }

  return parsedMeta;
}

/**
 * Returns file content object: meta, body, path and stat.
 *
 * @param {String} filePath Path to file.
 * @return {Object}
 */
async function parseFile(filePath) {
  let rawFileContent = await fs.readFile(filePath, 'utf-8');
  let fileStat = await fs.stat(filePath);
  // let metaAndBody = fm(rawFileContent);
  let metaAndBody = matter(rawFileContent)
  // console.log(metaAndBody);

  let fileContent = {};
  fileContent.meta = metaAndBody.data;
  fileContent.body = metaAndBody.content;
  fileContent.path = filePath;
  fileContent.stat = fileStat;

  return fileContent;
}

/**
 * Returns parsed file body and excerpt
 *
 * @param {String} body File body string.
 * @return {Object}
 */
function parseBody(body) {
  let parsedBody = body;
  parsedBody = md.render(parsedBody); // markdown
  parsedBody = richtypo.rich(parsedBody); // typography

  let parsedBodyAndExcerpt = {
    full: parsedBody,
    excerpt: util.splitTwo(parsedBody, conf.cutString).shift()
    // description: util.getDescriptionFromContent(parsedBody, 400)
  };

  // console.log(parsedBodyAndExcerpt);
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

async function makeCategoryCollections(collection, environment) {
  let categoryCollections = {};

  for (let item of collection) {
    const category = item.category;
    if (category) {
      categoryCollections[item.category] = categoryCollections[item.category] || [];
      categoryCollections[item.category].push(item);
    }
  }
  // console.log(categoryCollections);
  return categoryCollections;
}

async function generateCategories(categoryCollections, templates, environment) {
  // return await Promise.all(
  //   Object.keys(categoryCollections).map(
  //     (categoryCollection, categoryCollectionName) => generateList(categoryCollection, templates, environment, 'category', 100, categoryCollectionName)
  //   )
  // );
  // console.log(categoryCollections);

  if (_.isEmpty(categoryCollections)) {
    return;
  }

  for (let collectionName of Object.keys(categoryCollections)) {
    console.log('this is the collection here: ' + collectionName);
    const currentCategoryCollection = categoryCollections[collectionName];
    await generateList(currentCategoryCollection, templates, environment, 'category', 100, collectionName);
  }
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

  let htmlPath;
  if (environment.permalinks === 'retainStructure') {
    htmlPath = (docMeta.template === 'index') ?
               path.join(environment.outDir, environment.outPath, docMeta.fileRelativePath, 'index.html') :
               path.join(environment.outDir, environment.outPath, docMeta.fileRelativePath, slug, 'index.html');
  } else {
    htmlPath = (docMeta.template === 'index') ?
               path.join(environment.outDir, environment.outPath, 'index.html') :
               path.join(environment.outDir, environment.outPath, '/' + slug + '/', 'index.html');
  }

  if (util.findTraverse(conf.unforgivableFileNames, slug)) {
    console.log(slug + ' is a reserved name, please rename this document');
    return;
  }

  return fs.outputFile(htmlPath, html);
}

async function generateAllDocuments(collection, templates, environment) {
  return await Promise.all(
    collection.map(item => generateOneDocument(item, templates, environment))
  );
  // for (let item of collection) {
  //   await generateOneDocument(item, templates, environment);
  // }
}

async function generateList(collection, templates, environment, type, limit, listName) {
  // for archive and category use all documents in collection,
  // limit them for recent posts or rss feed

  let documentList = (type === 'archive' || type === 'category') ? collection : collection.slice(0, limit);

  // filter unpublished posts and all pages
  function isNotDraftOrPage(element) {
    if (element.type !== 'page' &&  element.type !== 'draft' &&  element.published) {
      if (type === 'feed' && element.excludeFeed) {
        return false;
      }
      return element;
    }
  }

  documentList = documentList.filter(isNotDraftOrPage);

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
      break;
    case 'category':
      title = conf.strings[environment.lang].blog;
      outputPath = listName + '/index.html';
  }

  const data = {
    documentList: documentListWithBody,
    title: title,
    environment: environment,
    updated: documentListWithBody[0].pubDate,
    strings: conf.strings[environment.lang],
    navPath: environment.outPath,
    isBlog: environment.isBlog
  };

  const html = templates[type](data);

  return fs.outputFile(path.join(environment.outDir, environment.outPath, outputPath), html);
}

function generateAllLists(newCollection, templates, environment) {
  return Promise.all([
    generateList(newCollection, templates, environment, 'archive'),
    generateList(newCollection, templates, environment, 'blog', conf.postsOnBlogIndex),
    generateList(newCollection, templates, environment, 'feed', conf.postsOnFeed)
  ]);
}

function saveCollection(newCollection, environment) {
  let collectionPath = path.join(environment.outDir, environment.outPath, 'collection.json');
  newCollection = JSON.stringify(newCollection);
  return fs.outputFile(collectionPath, newCollection);
}

async function generate(environment) {
  let fileList = await getAllFiles(environment);
  let collection = await makeCollection(fileList, environment);
  let categoryCollections = await makeCategoryCollections(collection, environment);
  let templates = await compileTemplates(environment);

  await saveCollection(collection, environment);
  await generateAllDocuments(collection, templates, environment);
  await generateCategories(categoryCollections, templates, environment);

  if ( environment.isBlog ) {
    await generateAllLists(collection, templates, environment);
  }

  console.log(environment.name + ' generated');
}

export async function run(option) {
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
