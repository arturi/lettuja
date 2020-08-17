const conf = require('../config.json')
const environments = require('../environments.json')

const util = require('./util.js')
const path = require('path')
const url = require('url')
const glob = require('glob-promise')
const fs = require('fs-promise')
const matter = require('gray-matter')
const richtypo = require('richtypo')
const handlebars = require('handlebars')
const moment = require('moment')
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
})
// const minify = require('html-minifier').minify;

async function compileTemplates (environment) {
  const templatePathList = await glob(environment.views + '/**/*' + conf.templateFileExt)

  const templates = {}
  for (const templatePath of templatePathList) {
    // templatePathList.map(templatePath => fs.readFile(templatePath, 'utf-8'));

    const templateContent = await fs.readFile(templatePath, 'utf-8')
    const templateFileName = path.basename(templatePath, conf.templateFileExt)
    const templateName = templateFileName.replace('_', '')

    // register templates that start with _ as partials
    if (templateFileName.substring(0, 1) === '_') {
      handlebars.registerPartial(templateName, templateContent)
    } else {
      templates[templateName] = handlebars.compile(templateContent)
    }
  }
  return templates
}

function getAllFiles (environment) {
  return glob(environment.src + '/**/*' + conf.contentFileExt)
}

function parseMeta (fileContent, environment) {
  const parsedMeta = fileContent.meta

  // if date is unspecified, set to current
  if (parsedMeta.datePublished === undefined) {
    parsedMeta.datePublished = moment().format('YYYY-MM-DD HH:mm')
  }

  // if template is unspecified, set to single
  if (parsedMeta.template === undefined) {
    if (parsedMeta.type === 'page') {
      parsedMeta.template = 'page'
    } else {
      parsedMeta.template = 'single'
    }
  }

  parsedMeta.typoTitle = parsedMeta.title ? richtypo.title(parsedMeta.title) : ''
  parsedMeta.unixDate = moment.utc(parsedMeta.datePublished, 'YYYY-MM-DD HH:mm').unix()
  parsedMeta.stringDate = moment.utc(parsedMeta.datePublished, 'YYYY-MM-DD HH:mm').format('D MMMM YYYY')
  parsedMeta.stringDateTime = moment.utc(parsedMeta.datePublished, 'YYYY-MM-DD HH:mm').format('D MMMM YYYY, HH:mm')
  parsedMeta.pubDate = moment.utc(parsedMeta.datePublished, 'YYYY-MM-DD HH:mm').format('YYYY-MM-DDTHH:mm:ssZ')
  parsedMeta.yearMonthDate = moment.utc(parsedMeta.datePublished, 'YYYY-MM-DD HH:mm').format('YYYY-MM-DD')
  parsedMeta.lastModified = fileContent.stat.mtime.getTime()
  parsedMeta.filePath = fileContent.path
  parsedMeta.fileRelativePath = path.dirname(parsedMeta.filePath.split(environment.src)[1])
  parsedMeta.slug = path.basename(fileContent.path, conf.contentFileExt)
  parsedMeta.lang = environment.lang

  // Because we want example.com for root url, not example.com/index
  const slugForLink = parsedMeta.slug === 'index' ? '' : parsedMeta.slug

  if (environment.permalinks === 'retainStructure') {
    parsedMeta.absoluteLink = new URL(path.join(environment.outPath, parsedMeta.fileRelativePath, slugForLink, '/'), conf.siteURL)
    parsedMeta.relativeLink = `${environment.outPath}/${parsedMeta.fileRelativePath}/${slugForLink}/`
  } else {
    parsedMeta.absoluteLink = new URL(path.join(environment.outPath, slugForLink, '/'), conf.siteURL)
    parsedMeta.relativeLink = `${environment.outPath}/${slugForLink}/`
  }

  return parsedMeta
}

/**
 * Returns file content object: meta, body, path and stat.
 *
 * @param {String} filePath Path to file.
 * @return {Object}
 */
async function parseFile (filePath) {
  const rawFileContent = await fs.readFile(filePath, 'utf-8')
  const fileStat = await fs.stat(filePath)
  const metaAndBody = matter(rawFileContent)

  const fileContent = {}
  fileContent.meta = metaAndBody.data
  fileContent.body = metaAndBody.content
  fileContent.path = filePath
  fileContent.stat = fileStat

  return fileContent
}

/**
 * Returns parsed file body and excerpt
 *
 * @param {String} body File body string.
 * @return {Object}
 */
function parseBody (body) {
  let parsedBody = body
  parsedBody = md.render(parsedBody) // markdown
  parsedBody = richtypo.rich(parsedBody) // typography

  const parsedBodyAndExcerpt = {
    full: parsedBody,
    excerpt: util.splitTwo(parsedBody, conf.cutString).shift(),
    description: util.getDescriptionFromContent(parsedBody, 100)
  }

  return parsedBodyAndExcerpt
}

async function makeCollection (src, environment) {
  const collection = []
  for (const filePath of src) {
    const fileContent = await parseFile(filePath)
    const fileMeta = await parseMeta(fileContent, environment)
    collection.push(fileMeta)
  }
  return collection.sort(util.sortByDate).reverse()
}

async function makeCategoryCollections (collection, environment) {
  const categoryCollections = {}

  for (const item of collection) {
    const category = item.category
    if (category) {
      categoryCollections[item.category] = categoryCollections[item.category] || []
      categoryCollections[item.category].push(item)
    }
  }
  return categoryCollections
}

async function generateCategories (categoryCollections, templates, environment) {
  function isEmpty (obj) {
    return Object.keys(obj).length === 0
  }

  if (isEmpty(categoryCollections)) {
    return
  }

  for (const collectionName of Object.keys(categoryCollections)) {
    console.log('this is the collection here: ' + collectionName)
    const currentCategoryCollection = categoryCollections[collectionName]
    await generateList(currentCategoryCollection, templates, environment, 'category', 100, collectionName)
  }
}

async function generateOneDocument (docMeta, templates, environment) {
  const slug = path.basename(docMeta.filePath, conf.contentFileExt)
  const fileContent = await parseFile(docMeta.filePath)
  docMeta.body = parseBody(fileContent.body)
  docMeta.isSingle = true
  docMeta.isBlog = environment.isBlog
  docMeta.strings = conf.strings[environment.lang]
  docMeta.navPath = environment.outPath

  const html = templates[docMeta.template](docMeta)

  let htmlPath
  if (environment.permalinks === 'retainStructure') {
    htmlPath = (docMeta.template === 'index')
      ? path.join(environment.outDir, environment.outPath, docMeta.fileRelativePath, 'index.html')
      : path.join(environment.outDir, environment.outPath, docMeta.fileRelativePath, slug, 'index.html')
  } else {
    htmlPath = (docMeta.template === 'index')
      ? path.join(environment.outDir, environment.outPath, 'index.html')
      : path.join(environment.outDir, environment.outPath, '/' + slug + '/', 'index.html')
  }

  if (util.findTraverse(conf.unforgivableFileNames, slug)) {
    console.log(slug + ' is a reserved name, please rename this document')
    return
  }

  return fs.outputFile(htmlPath, html)
}

async function generateAllDocuments (collection, templates, environment) {
  return await Promise.all(
    collection.map(item => generateOneDocument(item, templates, environment))
  )
}

async function generateList (collection, templates, environment, type, limit, listName) {
  // for archive and category use all documents in collection,
  // limit them for recent posts or rss feed
  let documentList = (type === 'archive' || type === 'category') ? collection : collection.slice(0, limit)

  // filter unpublished posts and all pages
  function isNotDraftOrPage (element) {
    if (element.type !== 'page' && element.type !== 'draft' && element.published) {
      if (type === 'feed' && element.excludeFromFeed) {
        return false
      }
      return element
    }
  }

  documentList = documentList.filter(isNotDraftOrPage)

  const documentListWithBody = []
  for (const docMeta of documentList) {
    const fileContent = await parseFile(docMeta.filePath)
    docMeta.body = parseBody(fileContent.body)
    documentListWithBody.push(docMeta)
  }

  let pageTitle, outputPath
  switch (type) {
    case 'archive':
      pageTitle = conf.strings[environment.lang].archive
      outputPath = 'archive/index.html'
      break
    case 'blog':
      pageTitle = conf.strings[environment.lang].blogTitle
      outputPath = 'blog/index.html'
      break
    case 'feed':
      pageTitle = conf.strings[environment.lang].blog
      outputPath = 'blog-feed.xml'
      break
    case 'category':
      pageTitle = conf.strings[environment.lang].blog
      outputPath = listName + '/index.html'
  }

  const data = {
    documentList: documentListWithBody,
    pageTitle,
    environment,
    updated: documentListWithBody[0].pubDate,
    strings: conf.strings[environment.lang],
    navPath: environment.outPath,
    isBlog: environment.isBlog
  }

  const html = templates[type](data)

  return fs.outputFile(path.join(environment.outDir, environment.outPath, outputPath), html)
}

function generateAllLists (newCollection, templates, environment) {
  return Promise.all([
    generateList(newCollection, templates, environment, 'archive'),
    generateList(newCollection, templates, environment, 'blog', conf.postsOnBlogIndex),
    generateList(newCollection, templates, environment, 'feed', conf.postsOnFeed)
  ])
}

function saveCollection (newCollection, environment) {
  const collectionPath = path.join(environment.outDir, environment.outPath, 'collection.json')
  newCollection = JSON.stringify(newCollection)
  return fs.outputFile(collectionPath, newCollection)
}

async function generate (environment) {
  const fileList = await getAllFiles(environment)
  const collection = await makeCollection(fileList, environment)
  // const categoryCollections = await makeCategoryCollections(collection, environment)
  const templates = await compileTemplates(environment)

  await saveCollection(collection, environment)
  await generateAllDocuments(collection, templates, environment)
  // await generateCategories(categoryCollections, templates, environment)

  if (environment.isBlog) {
    await generateAllLists(collection, templates, environment)
  }

  console.log(environment.name + ' generated')
}

async function run (option) {
  try {
    if (option === 'regenerateAll') {
      conf.regenerateAll = true
    }

    const startTime = new Date().getTime()

    for (const env in environments) {
      const environment = environments[env]
      environment.name = env
      moment.locale(environment.lang)
      richtypo.lang(environment.lang)

      await generate(environment)
    }

    const endTime = new Date() - startTime
    console.log(`all done in ${endTime / 1000} seconds, on ${moment().format('HH:mm:ss YYYY-MM-DD')}`)
  } catch (err) {
    onerror(err)
  }
}

function onerror (err) {
  console.error(err.stack)
}

module.exports = {
  run
}
