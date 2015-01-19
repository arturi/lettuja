'use strict';

var config = require('./config.json');
var environments = require('./environments.json');
var util = require('./utilities.js');
var Promise = require('bluebird');
var path = require('path');
var glob = Promise.promisify(require('glob'));
var fs = Promise.promisifyAll(require('fs-extra'));
var marked = require('marked');
var md = require('markdown-it')({
  html: true,
  typographer: true,
  breaks: true
});
var richtypo = require('richtypo');
var handlebars = require('handlebars');
var moment = require('moment');

function compileTemplates(environment) {
	var templates = {};
	return glob(environment.views + '/**/*' + config.templateFileExt).each(function(viewPath) {
		return fs.readFileAsync(viewPath, 'utf-8').then(function(viewContent) {
			var templateFileName = path.basename(viewPath, config.templateFileExt);
			var templateName = templateFileName.replace('_', '');
			if (templateFileName.substring(0, 1) === '_') {
				handlebars.registerPartial(templateName, viewContent);
			} else {
				templates[templateName] = handlebars.compile(viewContent);
			}
		});
	})
	.then(function() {
		return templates;
	});
}

function getAllFiles(environment) {
	return glob(environment.src + '/**/*' + config.contentFileExt);
}

function parseMeta(fileContent, environment) {
	var parsedMeta = {};
	var meta = fileContent.meta.split('\n');
	meta.forEach(function(line) {
		var keyVal = util.splitTwo(line, ':');
		parsedMeta[keyVal[0].toLowerCase()] = keyVal[1].trim();
	});
	parsedMeta.rawTitle = parsedMeta.title;
	parsedMeta.title = richtypo.title(parsedMeta.title);
	parsedMeta.unixDate = moment(parsedMeta.date, 'YYYY-MM-DD HH:mm').unix();
	parsedMeta.stringDate = moment(parsedMeta.date, 'YYYY-MM-DD HH:mm').format('D MMMM YYYY');
	parsedMeta.pubDate = moment(parsedMeta.date, 'YYYY-MM-DD HH:mm').format();
	parsedMeta.lastModified = fileContent.stat.mtime.getTime();
	parsedMeta.filePath = fileContent.path;
	parsedMeta.slug = path.basename(fileContent.path, config.contentFileExt);
	parsedMeta.absoluteLink = config.siteURL + environment.outPath + '/' + parsedMeta.slug + '/';
	parsedMeta.relativeLink = environment.outPath + '/' + parsedMeta.slug + '/';
	parsedMeta.lang = environment.lang;
	return parsedMeta;
}

function parseFile(filePath) {
	return Promise.join(
		fs.readFileAsync(filePath, 'utf-8'), 
		fs.statAsync(filePath),
		function(rawFileContent, fileStat) {
			var metaAndBody = util.splitTwo(rawFileContent, '\n\n');
			var fileContent = {};
			fileContent.meta = metaAndBody[0];
			fileContent.body = metaAndBody[1];
			fileContent.path = filePath;
			fileContent.stat = fileStat;
			return fileContent;
		});
}

function parseBody(body) {
	// return richtypo.rich(marked(body));
	return richtypo.rich(md.render(body));
}

function makeCollection(src, environment) {
	return Promise.all(src.map(function(filePath) {
		return parseFile(filePath).then(function(fileContent) {
			return parseMeta(fileContent, environment);
		});
	}));
}

function generateOne(docMeta, templates, environment) {
	var slug = path.basename(docMeta.filePath, config.contentFileExt);
	parseFile(docMeta.filePath).then(function(fileContent) {
		return parseBody(fileContent.body);
	})
	.then(function(parsedBody) {
		var data = {
			body: parsedBody,
			meta: docMeta,
			strings: config.strings[environment.lang]
		};
		return templates.single(data);
	})
	.then(function(html) {
		return fs.outputFileAsync(
			environment.outDir + environment.outPath + '/' + slug + '.html', html
		);
	});
}

function generateAll(collection, templates, environment) {
	return collection.forEach(function(item) {
		return generateOne(item, templates, environment);
	});
}

function saveCollection(newCollection, environment) {
	var collectionPath = environment.outDir + environment.outPath + '/collection.json';
	newCollection = JSON.stringify(newCollection);
	return fs.outputFileAsync(collectionPath, newCollection);
}

function makeModifiedCollection(newCollection, environment) {
	var oldCollectionPath = environment.outDir + environment.outPath + '/collection.json';
	return fs.readFileAsync(oldCollectionPath, 'utf-8')
		.then(function(oldCollection) {
			oldCollection = JSON.parse(oldCollection);
			if (Object.keys(oldCollection).length === 0) {
				return newCollection;
			}

			var modifiedCollection = [];
			for (var i = 0; i < newCollection.length; i++) {
				if (util.isNewOrModifiedItem(oldCollection, newCollection[i])) {
					modifiedCollection.push(newCollection[i]);
				}
			}

			return modifiedCollection;
		})
		.catch(function(err) {
		  console.log('generating from scratch');
		  return newCollection;
		});
}

function generate(environment) {
	return getAllFiles(environment)
		.then(function(fileList) {
			return Promise.join(
				makeCollection(fileList, environment), 
				compileTemplates(environment),
			  function(newCollection, templates) {
			    return makeModifiedCollection(newCollection, environment)
			    	.then(function(modifiedCollection) {
				    	return saveCollection(newCollection, environment)
				    		.then(generateAll(modifiedCollection, templates, environment));
			  		});
			})
			.catch(function(err) {
			  console.log(err);
			});
		})
		.then(function() {
			console.log(environment.name + ' generated');
		});
}

function run() {
	var startTime = new Date().getTime();

	var environmentsArray = [];
	for(var item in environments) {
		environments[item].name = item;
		environmentsArray.push(environments[item]);
	}

	Promise.each(environmentsArray, function(environment) {
		return generate(environment);
	})
	.then(function() {
		var endTime = new Date() - startTime;
		console.log('all done in ' + endTime / 1000 + ' seconds, on ' +
		    moment().format('HH:mm:ss YYYY-MM-DD'));
	});
}

run();
