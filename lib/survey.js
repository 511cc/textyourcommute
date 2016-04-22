var moment = require('moment-timezone');
var nconf = require('nconf');
var _ = require('underscore');
var twilio = require('twilio');
var client = twilio(nconf.get('TWILIO_SID'), nconf.get('TWILIO_AUTH_TOKEN'));

var questions = require('../lib/questions');


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
      sendSMS(req, res, introSurvey.introText1, function(e) {
        if(e) return next(e);

        sendSMS(req, res, introSurvey.introText2, function(e) {
          if(e) return next(e);

          introSurvey.status = 'started';
          introSurvey.save(function(e) {
            if(e) return next(e);

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

        introSurvey.save(function(e) {
          if(e) return next(e);

          sendSMSResponse(app, req, res, nextQuestion, nextQuestionIndex);
        });
      } else {
        // Send thank you text
        introSurvey.status = 'completed';
        introSurvey.save(function(e) {
          if(e) return next(e);

          sendSMSResponse(app, req, res, questions.introThankYouText, 'end');
        });
      }
    } else {
      // Daily survey
      var date;
      var type;
      if(moment().tz('America/Los_Angeles').isBefore(moment().tz('America/Los_Angeles').hour(10))) {
        // its PM from the day before
        date = moment().tz('America/Los_Angeles').subtract(1, 'day').startOf('day');
        type = 'pm';
      } else if(moment().tz('America/Los_Angeles').isBefore(moment().tz('America/Los_Angeles').hour(19))) {
        // its AM from today
        date = moment().tz('America/Los_Angeles').startOf('day');
        type = 'am';
      } else {
        // its PM from today
        date = moment().tz('America/Los_Angeles').startOf('day');
        type = 'pm';
      }

      DailySurvey.findOne({src: req.body.From, date: date}, function(e, dailySurvey) {
        if(e) return next(e);

        if(!dailySurvey) {
          // create new survey object
          dailySurvey = new DailySurvey({
            src: req.body.From,
            date: date
          });
        }

        dailySurvey[`${type}Mode`] = response;
        dailySurvey.save(function(e) {
          if(e) return next(e);

          sendSMSResponse(app, req, res, questions.dailyThankYouText, 'end');
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
    client.sendMessage({
      from: req.body.To,
      to: req.body.From,
      body: body
    }, cb);
  } else {
    cb();
  }
}
