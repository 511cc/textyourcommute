const path = require('path');
const url = require('url');

const express = require('express');
const logger = require('morgan');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const mongoose = require('mongoose');
const nconf = require('nconf');

nconf
  .argv()
  .env()
  .file({file: './config.json'});

mongoose.Promise = global.Promise;
const db = mongoose.connect(nconf.get('MONGOLAB_URI'), {useNewUrlParser: true});

const app = express();

if (app.get('env') === 'development') {
  app.use(require('connect-livereload')());
}

app.set('views', path.join(__dirname, '/views'));
app.set('view engine', 'pug');

app.use(logger('combined'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(cookieParser(nconf.get('SESSION_SECRET')));
app.use(express.static(path.join(__dirname, 'public')));

let store;
let cookie;

if (app.get('env') !== 'development') {
  const RedisStore = require('connect-redis')(session);
  const redisURL = url.parse(nconf.get('REDIS_URL'));
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
  const memoryStore = session.MemoryStore;
  store = new memoryStore();
  cookie = {
    maxAge: 3600000
  };
}

app.use(session({
  store,
  secret: nconf.get('SESSION_SECRET'),
  saveUninitialized: true,
  resave: true,
  cookie
}));

require('./routes')(app);

// Error handlers
require('./lib/errors')(app);

module.exports = app;
