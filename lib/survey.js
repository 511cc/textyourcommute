const async = require('async');
const moment = require('moment-timezone');
const debug = require('debug')('textyourcommute');
const nconf = require('nconf');
const _ = require('underscore');
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(nconf.get('SENDGRID_API_KEY'));

const client = new twilio(nconf.get('TWILIO_SID'), nconf.get('TWILIO_AUTH_TOKEN'));

const questions = require('../lib/questions');

const AMStartHour = 10;
const PMStartHour = 19;

function isPM() {
  return moment().tz('America/Los_Angeles').isAfter(moment().tz('America/Los_Angeles').hour(PMStartHour).startOf('hour')) || moment().tz('America/Los_Angeles').isBefore(moment().tz('America/Los_Angeles').hour(AMStartHour).startOf('hour'));
}

function getSurveyDate() {
  let date;
  if (moment().tz('America/Los_Angeles').isBefore(moment().tz('America/Los_Angeles').hour(AMStartHour).subtract(5, 'minute'))) {
    // Its from the day before
    date = moment().tz('America/Los_Angeles').subtract(1, 'day').startOf('day');
  } else {
    // Its from today
    date = moment().tz('America/Los_Angeles').startOf('day');
  }
  return date.toDate();
}

function formatResponse(number, response) {
  if (number === 4) {
    const cleanedResponse = response.toLowerCase().trim();
    if (cleanedResponse === 'yes' || cleanedResponse === 'y') {
      return 'yes';
    } else {
      return 'no';
    }
  }

  return response.trim();
}

function doSurvey(app, req, res, next) {
  var IntroSurvey = app.set('db').model('survey');
  var DailySurvey = app.set('db').model('daily_survey');
  var response = req.body.Body.trim().toLowerCase();
  var controlWords = ['test', 'start'];

  IntroSurvey.findOne({src: req.body.From}, (e, introSurvey) => {
    if (e) return next(e);

    if (!introSurvey) {
      if (nconf.get('SURVEY_OPEN') !== true) {
        return sendSMS(req, res, questions.surveyClosed);
      }

      // Create new survey object
      introSurvey = new IntroSurvey({src: req.body.From});
    }

    if (!introSurvey.answers.length && !introSurvey.status) {
      // Send intro text
      sendSMS(req, res, questions.introText1)
      .then(() => {
        setTimeout(() => {
          sendSMS(req, res, questions.introText2)
          .then(() => {
            introSurvey.status = 'started';
            introSurvey.save((e) => {
              if (e) return next(e);
              setTimeout(() => {
                doSurvey(app, req, res, next);
              }, 1000);
            });
          });
        }, 1000);
      })
      .catch(next);
    } else if (introSurvey.status === 'started') {
      // Intro Survey
      if (!_.include(controlWords, response)) {
        // Don't save answer if 'test' or 'start'
        const number = introSurvey.answers.length;
        introSurvey.answers.push({
          number,
          answer: formatResponse(number, response)
        });
      }

      if (introSurvey.answers.length < questions.questions.length) {
        // Send next question
        var nextQuestionIndex = introSurvey.answers.length;
        var nextQuestion = questions.questions[nextQuestionIndex];

        introSurvey.save((e) => {
          if (e) return next(e);

          sendSMSResponse(app, req, res, nextQuestion, nextQuestionIndex);
        });
      } else {
        // Send thank you text
        introSurvey.status = 'completed';
        introSurvey.save((e) => {
          if (e) return next(e);

          const emailAnswer = _.find(introSurvey.answers, {number: 0});

          if (emailAnswer) {
            const msg = {
              to: emailAnswer.answer,
              from: '511 Contra Costa <tips@511contracosta.org>',
              subject: questions.emailSubject,
              text: questions.emailBody,
              html: questions.emailHtml
            };
            sgMail.send(msg)
            .then(() => {
              console.log(`Welcome email sent to ${emailAnswer.answer}`);
            })
            .catch(err => {
              console.error(err.toString());
            });
          }

          sendSMSResponse(app, req, res, questions.introThankYouText, 'end');
        });
      }
    } else if (response === 'y' || response === 'yes' || response.indexOf('yes') !== -1) {
      const date = getSurveyDate();
      DailySurvey.findOne({src: req.body.From, date: date}, (e, dailySurvey) => {
        if(e) return next(e);

        if(!dailySurvey) {
          return next(new Error('Error: Unable to find daily survey for ' + req.body.From + ' ' + date));
        }

        dailySurvey.commuted = true;

        dailySurvey.save((e) => {
          if (e) return next(e);
          // ask about morning
          sendSMSResponse(app, req, res, questions.dailyMorning, 'end');
        });
      });
    } else if (response === 'n' || response === 'no') {
      const date = getSurveyDate();
      DailySurvey.findOne({src: req.body.From, date: date}, (e, dailySurvey) => {
        if (e) return next(e);

        if(!dailySurvey) {
          return next(new Error('Error: Unable to find daily survey for ' + req.body.From + ' ' + date));
        }

        dailySurvey.commuted = false;

        dailySurvey.save((e) => {
          if(e) return next(e);
          // Thank the user
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
  client.messages.create({
    to: req.body.To,
    from: nconf.get('TWILIO_NUMBER'),
    body: `Message recieved ${moment().format()}`
  })
  .then(message => {
    res.send(message.sid);
  })
  .catch(next);
}


function sendSMSResponse(app, req, res, body, status) {
  var Sms = app.set('db').model('sms');

  // don't send SMS if `test` is true
  if(req.body.test !== 'true') {

    debug(`Sending SMS to ${req.body.From}: ${body}`);

    const response = new twilio.twiml.MessagingResponse();
    const message = response.message();
    message.body(body);
    res.send(response.toString());

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

function sendSMS(req, res, body) {

  if(req.body.test === 'true') {
    // don't send SMS if `test` is true
    return Promise.resolve();
  }

  debug(`Sending SMS to ${req.body.From}: ${body}`);
  return client.messages.create({
    from: req.body.To,
    to: req.body.From,
    body: body
  });
}


exports.handleIncoming = function(app, req, res, next) {
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
};


exports.sendNotification = function(app, notificationText, cb) {
  const IntroSurvey = app.set('db').model('survey');

  debug('Sending Notification SMS to all users');

  IntroSurvey.find({status: 'completed'})
    .then((users) => {
      const twilioErrors = [];
      async.eachLimit(users, 10, (user, cb) => {
        client.messages.create({
          from: nconf.get('TWILIO_NUMBER'),
          to: user.src,
          body: notificationText
        })
        .catch(err => {
          if(err && err.message) {
            twilioErrors.push(`${user.src}: ${err.message}`);
          }
          cb();
        });
      }, (err) => {
        if(err) {
          console.error(err);
        }
        cb(null, {twilioErrors});
      });
    }, cb);
};
