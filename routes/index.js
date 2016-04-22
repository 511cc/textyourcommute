var _ = require('underscore');
var moment = require('moment-timezone');
var bcrypt = require('bcrypt');
var nconf = require('nconf');
var salt = bcrypt.genSaltSync(10);
var survey = require('../lib/survey');
var questions = require('../lib/questions');
var twilio = require('twilio');

var models = require('../models/models');

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

  /* Routes */

  app.get('/', isAuthenticated, function(req, res) {
    res.render('index');
  });


  app.get('/messageLog', isAuthenticated, getMessageLog);
  app.get('/messageLog/:page', isAuthenticated, getMessageLog);

  function getMessageLog(req, res, next) {
    var resultsPerPage = 100;
    var page = (parseInt(req.body.page, 10)) ? req.body.page : 1;
    Sms
      .find()
      .sort({$natural: -1})
      .limit(resultsPerPage)
      .skip((page - 1) * resultsPerPage)
      .exec((e, results) => {
        if(e) return next(e);
        Sms.count((e, count) => {
          if(e) return next(e);
          res.render('messageLog', {results: results, page: page, pages: Math.ceil(count / resultsPerPage), resultsPerPage: resultsPerPage});
        });
      });
  }

  app.get('/results', isAuthenticated, function(req, res, next) {
    Survey
      .find()
      .sort({$natural: -1})
      .exec((e, results) => {
        if(e) return next(e);
        res.render('results', { results: results, questions: questions.questions });
      });
  });

  app.get('/results/edit/:id', isAuthenticated, function(req, res, next) {
    Survey
      .findOne({_id: req.body.id})
      .exec((e, result) => {
        if(e) return next(e);
        res.render('editResult', {result: result, questions: questions.questions, referer: req.header('Referer')});
      });
  });

  app.post('/api/results/update/:id', isAuthenticated, function(req, res, next) {
    var answers = [];
    _.each(req.body, (answer, i) => {
      if(!isNaN(parseFloat(i))){
        answers.push({number: i, answer: answer});
      }
    });
    Survey.update({_id: req.body.id}, {$set: { answers: answers }}, {upsert: true}, (e) => {
      if(e) return next(e);
      res.redirect(req.body.referer);
    });
  });


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

  app.get('/downloads/results.csv', isAuthenticated, function(req, res, next) {
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
          var line = result.answers.map((answer) => {
            return answer.answer;
          });
          line.unshift( result.src );
          csv += line.join(',') + '\n';
        });
        res.write(csv);
        res.end();
      });
  });


  app.get('/api/questions', isAuthenticated, function(req, res) {
    res.json(questions);
  });


  app.post('/incoming', twilio.webhook(), function(req, res, next) {
    if(!req.body.Body) {
      return next(new Error('No SMS body'));
    }

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


  app.get('/api/results', isAuthenticated, function(req, res) {
    Survey.find((e, results) => {
      res.json(results);
    });
  });
};
