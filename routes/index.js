const _ = require('underscore');
const debug = require('debug')('textyourcommute');
const moment = require('moment-timezone');
const bcrypt = require('bcrypt');
const nconf = require('nconf');
const twilio = require('twilio');
const json2csv = require('json2csv').parse;

const salt = bcrypt.genSaltSync(10);

const survey = require('../lib/survey');
const questions = require('../lib/questions');

const {SMS, User, Survey, DailySurvey} = require('../models/models');

function isAuthenticated(req, res, next) {
  if (req.session.isAuthenticated) {
    next();
  } else {
    res.redirect('/login');
  }
}

module.exports = function (app) {
  app.get('/', isAuthenticated, (req, res) => {
    res.render('index');
  });

  app.get('/messageLog', isAuthenticated, getMessageLog);
  app.get('/messageLog/:page', isAuthenticated, getMessageLog);

  function getMessageLog(req, res, next) {
    const resultsPerPage = 100;
    const page = req.params.page ? parseInt(req.params.page, 10) : 1;

    SMS
      .find()
      .sort({$natural: -1})
      .limit(resultsPerPage)
      .skip((page - 1) * resultsPerPage)
      .exec((e, results) => {
        if (e) {
          return next(e);
        }

        SMS.count((e, count) => {
          if (e) {
            return next(e);
          }

          res.render('messageLog', {
            results,
            page,
            pages: Math.ceil(count / resultsPerPage),
            resultsPerPage
          });
        });
      });
  }

  app.get('/users', isAuthenticated, getUsers);
  app.get('/users/:page', isAuthenticated, getUsers);

  function getUsers(req, res, next) {
    const resultsPerPage = 100;
    const page = req.params.page ? parseInt(req.params.page, 10) : 1;

    Survey
      .find()
      .sort({$natural: -1})
      .limit(resultsPerPage)
      .skip((page - 1) * resultsPerPage)
      .exec((e, users) => {
        if (e) {
          return next(e);
        }

        Survey.count((e, count) => {
          if (e) {
            return next(e);
          }

          res.render('users', {
            users,
            questions: questions.questions,
            page,
            pages: Math.ceil(count / resultsPerPage),
            resultsPerPage
          });
        });
      });
  }

  app.get('/results', isAuthenticated, getResults);
  app.get('/results/:page', isAuthenticated, getResults);

  function isNormalInteger(str) {
    const n = ~~Number(str);
    return String(n) === str && n >= 0;
  }

  function formatModeResult(result) {
    if (result === '' || result === undefined) {
      return ['', ''];
    }

    const resultsArray = _.compact(result.split(' ').map(item => item.trim().replace(/,/g, '')));

    let formattedResult = [
      resultsArray.shift() || '',
      resultsArray.shift() || ''
    ];

    if (!isNormalInteger(formattedResult[0])) {
      formattedResult = [result, ''];
    }

    return formattedResult;
  }

  function getResults(req, res, next) {
    const resultsPerPage = 100;
    const page = req.params.page ? parseInt(req.params.page, 10) : 1;

    DailySurvey
      .find()
      .lean()
      .sort({date: -1})
      .limit(resultsPerPage)
      .skip((page - 1) * resultsPerPage)
      .exec((e, results) => {
        if (e) {
          return next(e);
        }

        results.forEach(result => {
          result.date = moment(result.date).tz('America/Los_Angeles').format('YYYY-MM-DD');
          const amModeArray = formatModeResult(result.amMode);
          const pmModeArray = formatModeResult(result.pmMode);
          result.amMode1 = amModeArray[0];
          result.amMode2 = amModeArray[1];
          result.pmMode1 = pmModeArray[0];
          result.pmMode2 = pmModeArray[1];
        });

        DailySurvey.count((e, count) => {
          if (e) {
            return next(e);
          }

          res.render('results', {
            results,
            page,
            pages: Math.ceil(count / resultsPerPage),
            resultsPerPage,
            modeOptions: questions.modeOptions
          });
        });
      });
  }

  app.get('/tester', isAuthenticated, (req, res) => {
    res.render('tester');
  });

  app.post('/api/sms-test', isAuthenticated, (req, res, next) => {
    if (!req.body.Body) {
      return next(new Error('No SMS body'));
    }

    survey.handleIncoming(req, res, next);
  });

  app.get('/notification', isAuthenticated, (req, res) => {
    res.render('notification');
  });

  app.post('/api/notification', isAuthenticated, (req, res, next) => {
    if (!req.body.notificationText) {
      return next(new Error('No notification text sent'));
    }

    if (req.body.notificationText.length > 160) {
      return next(new Error('Notification text too long (max 160 characters)'));
    }

    survey.sendNotification(app, req.body.notificationText, (err, results) => {
      if (err) {
        return next(err);
      }

      return res.json(results);
    });
  });

  app.get('/login', (req, res) => {
    res.render('login', {title: 'Text Your Commute | Login', loggedIn: false});
  });

  app.post('/sessions/create', (req, res, next) => {
    User.findOne({username: req.body.username}, (e, result) => {
      if (e) {
        return next(e);
      }

      if (result && bcrypt.compareSync(req.body.password, result.password)) {
        req.session.user = {
          username: result.username
        };
        req.session.isAuthenticated = true;
        res.redirect('/');
      } else {
        res.render('login', {title: 'Text Your Commute | Login', error: 'Login Error'});
      }
    });
  });

  app.get('/logout', (req, res, next) => {
    req.session.destroy(e => {
      if (e) {
        return next(e);
      }

      res.redirect('/login');
    });
  });

  app.get('/signup', (req, res) => {
    res.render('signup', {title: 'Text Your Commute | Create New User'});
  });

  app.post('/users/create', (req, res) => {
    if (nconf.get('ALLOW_SIGNUP') === 'true' || req.session.isAuthenticated) {
      if (req.body.username && req.body.password) {
        if (req.body.password == req.body.passwordAgain) {
          const user = new User({
            username: req.body.username,
            password: bcrypt.hashSync(req.body.password, salt)
          });

          user.save(e => {
            if (e) {
              res.render('signup', {title: 'Text Your Commute | Create New User', error: e});
            } else {
              res.redirect('/login');
            }
          });
        } else {
          res.render('signup', {title: 'Text Your Commute | Create New User', error: 'Mismatched Passwords'});
        }
      } else {
        res.render('signup', {title: 'Text Your Commute | Create New User', error: 'Missing Username or Password'});
      }
    } else {
      res.render('signup', {title: 'Text Your Commute | Create New User', error: 'Signup not allowed'});
    }
  });

  app.get('/downloads/users.csv', isAuthenticated, (req, res, next) => {
    Survey
      .find()
      .sort({$natural: -1})
      .exec((e, results) => {
        if (e) {
          return next(e);
        }

        res.writeHead(200, {'Content-Type': 'text/csv'});

        var csv = 'Number';
        results[0].answers.forEach((answer, i) => {
          csv += `,Q${i + 1}`;
        });
        csv += '\n';
        results.forEach(result => {
          const line = result.answers.map(answer => {
            const item = answer.answer === undefined ? '' : answer.answer;
            return `"${item}"`;
          });
          line.unshift(`"${result.src}"`);
          csv += line.join(',') + '\n';
        });
        res.write(csv);
        res.end();
      });
  });

  app.get('/downloads/results.csv', isAuthenticated, (req, res, next) => {
    DailySurvey
      .find()
      .sort({date: -1})
      .exec((e, results) => {
        if (e) {
          return next(e);
        }

        const opts = {
          fields: [
            {
              label: 'Number',
              value: 'src'
            },
            {
              label: 'Date',
              value: row => moment(row.date).tz('America/Los_Angeles').format('YYYY-MM-DD')
            },
            {
              label: 'Commuted?',
              value: 'commuted'
            },
            {
              label: 'AM Mode',
              value: 'amMode'
            },
            {
              label: 'PM Mode',
              value: 'pmMode'
            },
            {
              label: 'AM Carpool Count',
              value: 'amCarpoolCount'
            },
            {
              label: 'PM Carpool Count',
              value: 'pmCarpoolCount'
            },
            {
              label: 'AM Carpool Role',
              value: 'amCarpoolRole'
            },
            {
              label: 'PM Carpool Role',
              value: 'pmCarpoolRole'
            },
            {
              label: 'AM Rideshare Type',
              value: 'amRideshareOption'
            },
            {
              label: 'PM Rideshare Type',
              value: 'pmRideshareOption'
            },
            {
              label: 'AM Rideshare Count',
              value: 'amRideshareCount'
            },
            {
              label: 'PM Rideshare Count',
              value: 'pmRideshareCount'
            }
          ]
        };

        try {
          const csv = json2csv(results, opts);
          res.writeHead(200, {'Content-Type': 'text/csv'});
          console.log(csv);
          res.write(csv);
          res.end();
        } catch (error) {
          next(error);
        }
      });
  });

  app.get('/api/questions', isAuthenticated, (req, res) => {
    res.json(questions);
  });

  app.post('/incoming', twilio.webhook({url: nconf.get('TWILIO_WEBHOOK_URL')}), (req, res, next) => {
    if (!req.body.Body) {
      return next(new Error('No SMS body'));
    }

    debug(`Incoming SMS from ${req.body.From}: ${req.body.Body}`);

    // Save SMS
    const sms = new SMS({
      messageSid: req.body.MessageSid,
      from: req.body.From,
      to: req.body.To,
      body: req.body.Body,
      direction: 'inbound',
      timestamp: moment().format()
    });
    sms.save();

    survey.handleIncoming(req, res, next);
  });

  app.get('/api/users', isAuthenticated, (req, res) => {
    Survey.find((e, results) => {
      res.json(results);
    });
  });
};
