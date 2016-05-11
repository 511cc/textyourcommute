var express = require('express');
var path = require('path');
var url = require('url');
var logger = require('morgan');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var nconf = require('nconf');

nconf
  .argv()
  .env()
  .file({file:'./config.json'});

var db = require('mongoose').connect(nconf.get('MONGOLAB_URI'));

require('./models/models').setupModels();

var app = express();

if(app.get('env') === 'development') {
  app.use(require('connect-livereload')());
}

app.set('db', db);

app.set('views', __dirname + '/views');
app.set('view engine', 'jade');

app.use(logger('combined'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(cookieParser(nconf.get('SESSION_SECRET')));
app.use(express.static(path.join(__dirname, 'public')));

var store;
var cookie;

if(app.get('env') !== 'development') {
  var RedisStore = require('connect-redis')(session);
  var redisURL = url.parse(nconf.get('REDIS_URL'));
  store = new RedisStore({
    host: redisURL.hostname,
    port: redisURL.port,
    pass: redisURL.auth.split(':')[1],
    ttl: 1209600 // Two weeks
  });
  cookie = {
    maxAge: 31536000000
  };
} else {
  var memoryStore = session.MemoryStore;
  store = new memoryStore();
  cookie = {
    maxAge: 3600000
  };
}

app.use(session({
  store: store,
  secret: nconf.get('SESSION_SECRET'),
  saveUninitialized: true,
  resave: true,
  cookie: cookie
}));


require('./routes')(app);

// error handlers
require('./lib/errors')(app);

module.exports = app;
