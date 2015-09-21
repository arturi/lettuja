require('babel/register')({
  'optional': [ 'es7.asyncFunctions' ]
  // stage: 0
});
require('./lib/app.js');
