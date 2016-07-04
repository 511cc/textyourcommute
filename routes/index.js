const _ = require('underscore');
const debug = require('debug')('textyourcommute');
const moment = require('moment-timezone');
const bcrypt = require('bcrypt');
const nconf = require('nconf');
const salt = bcrypt.genSaltSync(10);
const twilio = require('twilio');

const survey = require('../lib/survey');
const questions = require('../lib/questions');

function isAuthenticated(req, res, next) {
  if(req.session.isAuthenticated) {
    next();
  } else {
    res.redirect('/login');
  }
}


module.exports = function routes(app){
  var Sms = app.set('db').model('sms');
  var User = app.set('db').model('user');
  var Survey = app.set('db').model('survey');
  var DailySurvey = app.set('db').model('daily_survey');

  /* Routes */

  app.get('/', isAuthenticated, function(req, res) {
    res.render('index');
  });


  app.get('/messageLog', isAuthenticated, getMessageLog);
  app.get('/messageLog/:page', isAuthenticated, getMessageLog);

  function getMessageLog(req, res, next) {
    const resultsPerPage = 100;
    const page = req.params.page ? parseInt(req.params.page, 10) : 1;

    Sms
      .find()
      .sort({$natural: -1})
      .limit(resultsPerPage)
      .skip((page - 1) * resultsPerPage)
      .exec((e, results) => {
        if(e) return next(e);
        Sms.count((e, count) => {
          if(e) return next(e);

          res.render('messageLog', {
            results: results,
            page: page,
            pages: Math.ceil(count / resultsPerPage),
            resultsPerPage: resultsPerPage
          });
        });
      });
  }

  app.get('/users', isAuthenticated, function(req, res, next) {
    Survey
      .find()
      .sort({$natural: -1})
      .exec((e, users) => {
        if(e) return next(e);
        res.render('users', {
          users: users,
          questions: questions.questions
        });
      });
  });

  app.get('/results', isAuthenticated, getResults);
  app.get('/results/:page', isAuthenticated, getResults);

  function getResults(req, res, next) {
    const resultsPerPage = 100;
    const page = req.params.page ? parseInt(req.params.page, 10) : 1;

    DailySurvey
      .find()
      .lean()
      .sort({$natural: -1})
      .limit(resultsPerPage)
      .skip((page - 1) * resultsPerPage)
      .exec((e, results) => {
        if(e) return next(e);

        results.forEach((result) => {
          result.date = moment(result.date).tz('America/Los_Angeles').format('YYYY-MM-DD');
        });

        DailySurvey.count((e, count) => {
          if(e) return next(e);
          res.render('results', {
            results: results,
            page: page,
            pages: Math.ceil(count / resultsPerPage),
            resultsPerPage: resultsPerPage
          });
        });
      });
  }

  app.get('/tester', isAuthenticated, function(req, res) {
    res.render('tester');
  });


  app.post('/api/sms-test', isAuthenticated, function(req, res, next) {
    if(!req.body.Body) {
      return next(new Error('No SMS body'));
    }

    survey.handleIncoming(app, req, res, next);
  });


  app.get('/login', function(req, res) {
    res.render('login', { title: 'Text Your Commute | Login', loggedIn: false });
  });


  app.post('/sessions/create', function(req, res, next) {
    User.findOne({username: req.body.username}, (e, result) => {
      if(e) return next(e);
      if(result && bcrypt.compareSync(req.body.password, result.password)) {
        req.session.user = {
          username: result.username
        };
        req.session.isAuthenticated = true;
        res.redirect('/');
      } else {
        res.render('login', { title: 'Text Your Commute | Login', error: 'Login Error' });
      }
    });
  });

  app.get('/logout', function(req, res, next) {
    req.session.destroy(function(e){
      if(e) return next(e);
      res.redirect('/login');
    });
  });

  app.get('/signup', function(req, res) {
    res.render('signup', { title: 'Text Your Commute | Create New User' });
  });

  app.post('/users/create', function(req, res) {
    if(nconf.get('ALLOW_SIGNUP') === 'true' || req.session.isAuthenticated) {
      if(req.body.username && req.body.password){
        if(req.body.password == req.body.passwordAgain){
          var user = new User({
            username: req.body.username,
            password: bcrypt.hashSync( req.body.password, salt )
          });
          user.save((e) => {
            if(e){
              res.render('signup', { title: 'Text Your Commute | Create New User', error: e});
            } else {
              res.redirect('/login');
            }
          });
        } else {
          res.render('signup', { title: 'Text Your Commute | Create New User', error: 'Mismatched Passwords' });
        }
      } else {
        res.render('signup', { title: 'Text Your Commute | Create New User', error: 'Missing Username or Password' });
      }
    } else {
      res.render('signup', { title: 'Text Your Commute | Create New User', error: 'Signup not allowed' });
    }
  });

  app.get('/downloads/users.csv', isAuthenticated, (req, res, next) => {
    Survey
      .find()
      .sort({$natural: -1})
      .exec((e, results) => {
        if(e) return next(e);

        res.writeHead(200, {'Content-Type':'text/csv'});

        var csv = 'Number';
        results[0].answers.forEach((answer, i) => {
          csv += ',Q' + (i+1);
        });
        csv += '\n';
        results.forEach((result) => {
          var line = result.answers.map((answer) => answer.answer);
          line.unshift( result.src );
          csv += line.join(',') + '\n';
        });
        res.write(csv);
        res.end();
      });
  });


  app.get('/downloads/results.csv', isAuthenticated, (req, res, next) => {
    DailySurvey
      .find()
      .sort({$natural: -1})
      .exec((e, results) => {
        if(e) return next(e);

        res.writeHead(200, {'Content-Type':'text/csv'});

        let csv = 'Number,Date,Commuted?,AM Mode,PM Mode\n';

        results.forEach((result) => {
          csv += [
            result.src,
            moment(result.date).tz('America/Los_Angeles').format('YYYY-MM-DD'),
            result.commuted,
            result.amMode,
            result.pmMode
          ].join(',') + '\n';
        });
        res.write(csv);
        res.end();
      });
  });


  app.get('/api/questions', isAuthenticated, (req, res) => {
    res.json(questions);
  });


  app.post('/incoming', twilio.webhook({url: nconf.get('TWILIO_WEBHOOK_URL'),}), (req, res, next) => {
    if(!req.body.Body) {
      return next(new Error('No SMS body'));
    }

    debug(`Incoming SMS from ${req.body.From}: ${req.body.Body}`);

    //Save SMS
    var sms = new Sms({
      messageSid: req.body.MessageSid,
      from: req.body.From,
      to: req.body.To,
      body: req.body.Body,
      direction: 'inbound',
      timestamp: moment().format()
    });
    sms.save();

    survey.handleIncoming(app, req, res, next);
  });


  app.get('/api/users', isAuthenticated, function(req, res) {
    Survey.find((e, results) => {
      res.json(results);
    });
  });
};
