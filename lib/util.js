'use strict'

const conf = require('../config.json')
const path = require('path')
const iuliia = require('iuliia').default

module.exports = {

  // Split any string into two by delimiter
  splitTwo: function (string, delimeter) {
    const position = string.indexOf(delimeter)
    return [string.substr(0, position), string.substr(position + delimeter.length)]
  },

  // Check if the supplied object is empty
  isObjEmpty: function (obj) {
    if (Object.keys(obj).length === 0) {
      return true
    }
    return false
  },

  // Sort array items by unixDate
  sortByDate: function (a, b) {
    if (a.unixDate < b.unixDate) {
      return -1
    }
    if (a.unixDate > b.unixDate) {
      return 1
    }
    return 0
  },

  // Search 'data' and return true if any item matches 'match'
  findTraverse: function (data, match) {
    let prop
    for (prop in data) {
      if (!data.hasOwnProperty(prop)) {
        continue
      }
      if (data[prop] === match) {
        return true
      }
      if (typeof data[prop] === 'object' && this.findTraverse(data[prop], match)) {
        return true
      }
    }
    return false
  },

  // Check if the item from the collection is new or modified
  // by first checking whether there is already an item with that slug (if not, then it’s new)
  // and then comparing lastModified for items with the same slug
  // isNewOrModifiedItem: function (oldCollection, newCollectionItem) {
  //   if (!this.findTraverse(oldCollection, newCollectionItem.slug)) {
  //     return true;
  //   }

  //   for (let i = 0; i < oldCollection.length; i++) {
  //     if (newCollectionItem.slug === oldCollection[i].slug &&
  //         newCollectionItem.lastModified !== oldCollection[i].lastModified) {
  //       return true;
  //     }
  //     return false;
  //   }
  // },

  slugifyHeaderId: function (s) {
    const optimizedString = s.trim()
      .toLowerCase()
      .replace(/\s\s+/g, ' ')
      .replace(/[^\w\s\u0400-\u04FF-]/g, '')
      .replace(/\s/g, '-')
      .toString()
    const result = iuliia.translate(optimizedString, iuliia.WIKIPEDIA)
    return result
  },

  isFilePathCorrect: function (filePath) {
    const fileExtension = path.extname(filePath)
    if (fileExtension === conf.contentFileExt) {
      return true
    } else {
      return false
    }
  },

  getDescriptionFromContent: function (content, length) {
    let description = content.replace(/<(?:.|\n)*?>/gm, '')
    description = description.replace(/\n\n/, '')
    description = description.substring(0, length)
    description = description.trim() + '...'
    return description
  }
}
