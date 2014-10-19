Lettuja
=======

A static site and blog generator written in Node.js. It takes Markdown ```.md``` files from a content folder ```content```, parses it using Handlebars templates and outputs HTML files to an  ```output``` folder.

## Features

* Supports multiple languages: ```content/ru```, ```content/en```, ```content/fi``` and so on. Update language strigs at ```config.json```
*  Supports post drafts, use ```type: draft``` in the post header and look for the draft at ```http://example.com/ru/drafts/your-draft-post```
* Image uploads and automatic resizing
* Github-flavored Markdown
* Blazing fast

## Usage

1. Update everything in ```config.json```: set up passwords, strings and URLs.
2. Run the app with ```node lib/index.js``` or use [PM2](https://github.com/Unitech/pm2).
3. Every time Lettuja detects a file change it will generate your site. To upload images, head to ```http://example.com/admin```
