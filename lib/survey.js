var moment = require('moment-timezone');
const debug = require('debug')('textyourcommute');
var nconf = require('nconf');
var _ = require('underscore');
var twilio = require('twilio');
var client = twilio(nconf.get('TWILIO_SID'), nconf.get('TWILIO_AUTH_TOKEN'));

var questions = require('../lib/questions');

const AMStartHour = 10;
const PMStartHour = 19;


module.exports = {
  handleIncoming: function(app, req, res, next) {
    var message = req.body.Body.toLowerCase();

    if (message == 'ping') {
      sendPing(app, req, res, next);
    } else if (message == 'reset') {
      resetQuestion(app, req, res, next);
    } else if (message == 'reset all') {
      resetSurvey(app, req, res, next);
    } else {
      doSurvey(app, req, res, next);
    }
  }
};


function isPM() {
  return moment().tz('America/Los_Angeles').isAfter(moment().tz('America/Los_Angeles').hour(PMStartHour)) || moment().tz('America/Los_Angeles').isBefore(moment().tz('America/Los_Angeles').hour(AMStartHour));
}


function getSurveyDate() {
  let date;
  if(moment().tz('America/Los_Angeles').isBefore(moment().tz('America/Los_Angeles').hour(AMStartHour).subtract(5, 'minute'))) {
    // its from the day before
    date = moment().tz('America/Los_Angeles').subtract(1, 'day').startOf('day');
  } else {
    // its from today
    date = moment().tz('America/Los_Angeles').startOf('day');
  }
  return date.toDate();
}


function doSurvey(app, req, res, next) {
  var IntroSurvey = app.set('db').model('survey');
  var DailySurvey = app.set('db').model('daily_survey');
  var response = req.body.Body.trim().toLowerCase();
  var controlWords = ['test', 'start'];

  IntroSurvey.findOne({src: req.body.From}, function(e, introSurvey){
    if(e) return next(e);

    if(!introSurvey) {
      // create new survey object
      introSurvey = new IntroSurvey({src: req.body.From});
    }

    if(!introSurvey.answers.length && !introSurvey.status) {
      // Send intro text
      sendSMS(req, res, questions.introText, function(e) {
        if(e) return next(e);

        introSurvey.status = 'started';
        introSurvey.save(function(e) {
          if(e) return next(e);
          setTimeout(() => {
            doSurvey(app, req, res, next);
          });
        });
      });
    } else if(introSurvey.status === 'started') {
      // Intro Survey
      if(!_.include(controlWords, response)) {
        // don't save answer if 'test' or 'start'
        introSurvey.answers.push({
          number: introSurvey.answers.length,
          answer: response
        });
      }

      if(introSurvey.answers.length < questions.questions.length) {
        // Send next question
        var nextQuestionIndex = introSurvey.answers.length;
        var nextQuestion = questions.questions[nextQuestionIndex];

        introSurvey.save((e) => {
          if(e) return next(e);

          sendSMSResponse(app, req, res, nextQuestion, nextQuestionIndex);
        });
      } else {
        // Send thank you text
        introSurvey.status = 'completed';
        introSurvey.save((e) => {
          if(e) return next(e);

          sendSMSResponse(app, req, res, questions.introThankYouText, 'end');
        });
      }
    } else if (response === 'y' || response === 'yes') {
      const date = getSurveyDate();
      DailySurvey.findOne({src: req.body.From, date: date}, (e, dailySurvey) => {
        if(e) return next(e);

        if(!dailySurvey) {
          return next(new Error('Error: Unable to find daily survey for ' + req.body.From + ' ' + date));
        }

        dailySurvey.commuted = true;

        dailySurvey.save((e) => {
          if(e) return next(e);
          // ask about morning
          sendSMSResponse(app, req, res, questions.dailyMorning, 'end');
        });
      });
    } else if (response === 'n' || response === 'no') {
      const date = getSurveyDate();
      DailySurvey.findOne({src: req.body.From, date: date}, (e, dailySurvey) => {
        if(e) return next(e);

        if(!dailySurvey) {
          return next(new Error('Error: Unable to find daily survey for ' + req.body.From + ' ' + date));
        }

        dailySurvey.commuted = false;

        dailySurvey.save((e) => {
          if(e) return next(e);
          // ask about morning
          sendSMSResponse(app, req, res, questions.dailyNoCommuteText, 'end');
        });
      });
    } else {
      // Daily survey
      const date = getSurveyDate();

      DailySurvey.findOne({src: req.body.From, date: date}, (e, dailySurvey) => {
        if(e) return next(e);

        if(!dailySurvey) {
          return next(new Error('Error: Unable to find daily survey for ' + req.body.From + ' ' + date));
        }

        const type = dailySurvey.amMode ? 'pm' : 'am';

        dailySurvey[`${type}Mode`] = response;
        dailySurvey.save((e) => {
          if(e) return next(e);

          // If survey is AM and it is PM already, send PM survey, else send thank you text
          if(type === 'am' && isPM()) {
            sendSMSResponse(app, req, res, questions.dailyEvening, 'end');
          } else {
            sendSMSResponse(app, req, res, questions.dailyThankYouText, 'end');
          }
        });
      });
    }
  });
}


function resetQuestion(app, req, res, next) {
  var IntroSurvey = app.set('db').model('survey');
  IntroSurvey.findOne({src: req.body.From}, function(e, survey) {
    if(e) return next(e);

    if(survey) {
      // remove last question if a survey exists
      survey.answers.pop();
      survey.save(function(e) {
        if(e) return next(e);
        doSurvey(app, req, res, next);
      });
    } else {
      sendSMSResponse(app, req, res, 'Text \'start\' to begin the survey.', 0);
    }
  });
}


function resetSurvey(app, req, res, next) {
  var IntroSurvey = app.set('db').model('survey');
  var DailySurvey = app.set('db').model('daily_survey');
  IntroSurvey.remove({src: req.body.From}, function(e) {
    if(e) return next(e);

    DailySurvey.remove({src: req.body.From}, function(e) {
      if(e) return next(e);

      var resetMessage = 'The survey has been reset. Text \'start\' to retake the survey.';
      sendSMSResponse(app, req, res, resetMessage, 0);
    });
  });
}


function sendPing(app, req, res, next) {
  client.sendMessage({
    to: req.body.To,
    from: nconf.get('TWILIO_NUMBER'),
    body: `Message recieved ${moment().format()}`
  }, (e, response) => {
    if(e) return next(e);

    res.send(response);
  });
}


function sendSMSResponse(app, req, res, body, status) {
  var Sms = app.set('db').model('sms');

  // don't send SMS if `test` is true
  if(req.body.test !== 'true') {

    debug(`Sending SMS to ${req.body.From}: ${body}`);

    var twiml = new twilio.TwimlResponse();
    twiml.message(body);
    res.send(twiml);

    var sms = new Sms({
      from: req.body.To,
      to: req.body.From,
      body: body,
      direction: 'outbound',
      timestamp: moment().format()
    });
    sms.save();
  } else {
    // testing survey, send next question as JSON
    res.json({
      question: body,
      status: status
    });
  }
}

function sendSMS(req, res, body, cb) {
  // don't send SMS if `test` is true
  if(req.body.test !== 'true') {
    debug(`Sending SMS to ${req.body.From}: ${body}`);
    client.sendMessage({
      from: req.body.To,
      to: req.body.From,
      body: body
    }, cb);
  } else {
    cb();
  }
}
