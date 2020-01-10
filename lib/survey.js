const async = require('async');
const moment = require('moment-timezone');
const debug = require('debug')('textyourcommute');
const nconf = require('nconf');
const _ = require('underscore');
const Twilio = require('twilio');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(nconf.get('SENDGRID_API_KEY'));

const client = new Twilio(nconf.get('TWILIO_SID'), nconf.get('TWILIO_AUTH_TOKEN'));

const {SMS, Survey, DailySurvey} = require('../models/models');

const questions = require('../lib/questions');

const AMStartHour = 10;
const PMStartHour = 19;

function isPM() {
  return moment().tz('America/Los_Angeles').isAfter(moment().tz('America/Los_Angeles').hour(PMStartHour).startOf('hour')) || moment().tz('America/Los_Angeles').isBefore(moment().tz('America/Los_Angeles').hour(AMStartHour).startOf('hour'));
}

function isCarpool(response) {
  return response.includes(1);
}

function isRideshare(response) {
  return response.includes(3);
}

function isYes(response) {
  return response === 'y' || response.includes('yes');
}

function isNo(response) {
  return response === 'n' || response.includes('no');
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
  if (number === 4 || number === 5 || number === 6) {
    const cleanedResponse = response.toLowerCase().trim();
    return (cleanedResponse === 'yes' || cleanedResponse === 'y') ? 'yes' : 'no';
  }

  return response.trim();
}

function countCleanTrips(dailySurveys) {
  return dailySurveys.reduce((memo, dailySurvey) => {
    if (dailySurvey.amMode && (dailySurvey.amMode.includes('1') || dailySurvey.amMode.includes('2') || dailySurvey.amMode.includes('3') || dailySurvey.amMode.includes('4') || dailySurvey.amMode.includes('5'))) {
      memo += 1;
    }

    if (dailySurvey.pmMode && (dailySurvey.pmMode.includes('1') || dailySurvey.pmMode.includes('2') || dailySurvey.pmMode.includes('3') || dailySurvey.pmMode.includes('4') || dailySurvey.pmMode.includes('5'))) {
      memo += 1;
    }

    return memo;
  }, 0);
}

function doSurvey(req, res, next) {
  const response = req.body.Body.trim().toLowerCase();
  const controlWords = ['test', 'start'];

  Survey.findOne({src: req.body.From}, (e, introSurvey) => {
    if (e) {
      return next(e);
    }

    if (!introSurvey) {
      if (nconf.get('SURVEY_STATUS') !== 'open') {
        return sendSMS(req, res, questions.surveyClosed);
      }

      // Create new survey object
      introSurvey = new Survey({src: req.body.From});
    }

    if (!introSurvey.answers.length && !introSurvey.status) {
      // Send intro text
      sendSMS(req, res, questions.introText1)
      .then(() => {
        setTimeout(() => {
          sendSMS(req, res, questions.introText2)
          .then(() => {
            introSurvey.status = 'started';
            introSurvey.save(e => {
              if (e) {
                return next(e);
              }
              setTimeout(() => {
                doSurvey(req, res, next);
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

        const ccZips = [
          '94565',
          '95219',
          '94596',
          '94595',
          '94598',
          '94597',
          '94507',
          '94506',
          '94509',
          '94511',
          '94801',
          '94513',
          '94803',
          '94802',
          '94805',
          '94804',
          '94517',
          '94807',
          '94516',
          '94806',
          '94519',
          '94518',
          '94808',
          '94521',
          '94520',
          '94523',
          '94525',
          '94505',
          '94526',
          '94528',
          '94531',
          '94530',
          '94548',
          '94547',
          '94549',
          '94553',
          '94556',
          '94561',
          '94563',
          '94564',
          '94569',
          '94572',
          '94583',
          '94582'
         ];

        if (number === 2) {
          if (!ccZips.includes(introSurvey.answers[1].answer) && !ccZips.includes(response)) {
            return sendSMSResponse(req, res, questions.notInContraCostaWarning, 'end');
          }
        }

        if (number === 3) {
          if (parseInt(response, 10) < 18) {
            return sendSMSResponse(req, res, questions.under18Warning, 'end');
          }
        }

        if (number === 4) {
          if (!isYes(response) && !isNo(response)) {
            return sendSMSResponse(req, res, questions.invalidYN, 'end');
          }
        }

        if (number === 5) {
          if (!isYes(response) && !isNo(response)) {
            return sendSMSResponse(req, res, questions.invalidYN, 'end');
          }
        }

        if (number === 6) {
          if (!isYes(response) && !isNo(response)) {
            return sendSMSResponse(req, res, questions.invalidYN, 'end');
          }
        }
      }

      if (introSurvey.answers.length < questions.questions.length) {
        // Send next question
        const nextQuestionIndex = introSurvey.answers.length;
        const nextQuestion = questions.questions[nextQuestionIndex];

        introSurvey.save(e => {
          if (e) {
            return next(e);
          }

          sendSMSResponse(req, res, nextQuestion, nextQuestionIndex);
        });
      } else {
        // Send thank you text
        introSurvey.status = 'completed';
        introSurvey.save(e => {
          if (e) {
            return next(e);
          }

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

          sendSMSResponse(req, res, questions.introThankYouText, 'end');
        });
      }
    } else {
      // Daily Survey
      const date = getSurveyDate();
      DailySurvey.findOne({src: req.body.From, date}, (e, dailySurvey) => {
        if (e) {
          return next(e);
        }

        if (!dailySurvey) {
          return next(new Error('Error: Unable to find daily survey for ' + req.body.From + ' ' + date));
        }

        if (dailySurvey.commuted === false) {
          // We already collected today's response
          sendSMSResponse(req, res, questions.dailyThankYouText, 'end');
        } else if (dailySurvey.commuted === undefined) {
          if (isYes(response)) {
            dailySurvey.commuted = true;

            dailySurvey.save(e => {
              if (e) {
                return next(e);
              }
              // Ask about morning
              sendSMSResponse(req, res, questions.dailyMorning, 'end');
            });
          } else if (isNo(response)) {
            dailySurvey.commuted = false;

            dailySurvey.save(e => {
              if (e) {
                return next(e);
              }
              // Thank the user
              sendSMSResponse(req, res, questions.dailyNoCommuteText, 'end');
            });
          } else {
            sendSMSResponse(req, res, questions.invalidYN, 'end');
          }
        } else {
          const type = isPM() ? 'pm' : 'am';

          if (!dailySurvey[`${type}Mode`]) {
            dailySurvey[`${type}Mode`] = response;
          } else if (isCarpool(dailySurvey[`${type}Mode`]) && !dailySurvey[`${type}CarpoolCount`]) {
            dailySurvey[`${type}CarpoolCount`] = response;
          } else if (isCarpool(dailySurvey[`${type}Mode`]) && !dailySurvey[`${type}CarpoolRole`]) {
            dailySurvey[`${type}CarpoolRole`] = isYes(response) ? 'driver' : 'passenger';
          } else if (isRideshare(dailySurvey[`${type}Mode`]) && !dailySurvey[`${type}RideshareOption`]) {
            dailySurvey[`${type}RideshareOption`] = response;
          } else if (isRideshare(dailySurvey[`${type}Mode`]) && !dailySurvey[`${type}RideshareCount`]) {
            dailySurvey[`${type}RideshareCount`] = response;
          }

          dailySurvey.save(e => {
            if (e) {
              return next(e);
            }

            if (isCarpool(dailySurvey[`${type}Mode`]) && !dailySurvey[`${type}CarpoolCount`]) {
              sendSMSResponse(req, res, questions.carpoolCount);
            } else if (isCarpool(dailySurvey[`${type}Mode`]) && !dailySurvey[`${type}CarpoolRole`]) {
              sendSMSResponse(req, res, questions.carpoolRole);
            } else if (isRideshare(dailySurvey[`${type}Mode`]) && !dailySurvey[`${type}RideshareOption`]) {
              sendSMSResponse(req, res, questions.ridershareOption);
            } else if (isRideshare(dailySurvey[`${type}Mode`]) && !dailySurvey[`${type}RideshareCount`]) {
              sendSMSResponse(req, res, questions.ridershareCount);
            } else {
              sendSMSResponse(req, res, questions.dailyThankYouText, 'end');
            }

            DailySurvey.find({src: req.body.From}, (e, dailySurveys) => {
              if (e) {
                return next(e);
              }

              const cleanTripCount = countCleanTrips(dailySurveys);
              console.log('Clean Trips:', cleanTripCount);

              if (cleanTripCount === 8) {
                sendSMS(req, res, questions.eightTrips);
              }

              if (cleanTripCount === 16) {
                sendSMS(req, res, questions.sixteenTrips);
              }

              if (cleanTripCount === 24) {
                sendSMS(req, res, questions.twentyFourTrips);
              }
            });
          });
        }
      });
    }
  });
}

function resetQuestion(req, res, next) {
  Survey.findOne({src: req.body.From}, (e, survey) => {
    if (e) {
      return next(e);
    }

    if (survey) {
      // Remove last question if a survey exists
      survey.answers.pop();
      survey.save(e => {
        if (e) {
          return next(e);
        }
        doSurvey(req, res, next);
      });
    } else {
      sendSMSResponse(req, res, 'Text \'start\' to begin the survey.', 0);
    }
  });
}

function resetSurvey(req, res, next) {
  Survey.remove({src: req.body.From}, e => {
    if (e) {
      return next(e);
    }

    DailySurvey.remove({src: req.body.From}, e => {
      if (e) {
        return next(e);
      }

      const resetMessage = 'The survey has been reset. Text \'start\' to retake the survey.';
      sendSMSResponse(req, res, resetMessage, 0);
    });
  });
}

function sendPing(req, res, next) {
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

function sendSMSResponse(req, res, body, status) {
  // Don't send SMS if `test` is true
  if (req.body.test !== 'true') {
    debug(`Sending SMS to ${req.body.From}: ${body}`);

    const response = new Twilio.twiml.MessagingResponse();
    const message = response.message();
    message.body(body);
    res.send(response.toString());

    const sms = new SMS({
      from: req.body.To,
      to: req.body.From,
      body,
      direction: 'outbound',
      timestamp: moment().format()
    });
    sms.save();
  } else {
    // Testing survey, send next question as JSON
    res.json({
      question: body,
      status
    });
  }
}

function sendSMS(req, res, body) {
  if (req.body.test === 'true') {
    // Don't send SMS if `test` is true
    return Promise.resolve();
  }

  debug(`Sending SMS to ${req.body.From}: ${body}`);

  const sms = new SMS({
    from: req.body.To,
    to: req.body.From,
    body,
    direction: 'outbound',
    timestamp: moment().format()
  });
  sms.save();

  return client.messages.create({
    from: req.body.To,
    to: req.body.From,
    body
  });
}

exports.handleIncoming = function (req, res, next) {
  const message = req.body.Body.toLowerCase();

  if (message === 'ping') {
    sendPing(req, res, next);
  } else if (message === 'reset') {
    resetQuestion(req, res, next);
  } else if (message === 'reset all') {
    resetSurvey(req, res, next);
  } else {
    doSurvey(req, res, next);
  }
};

exports.sendNotification = function (notificationText, cb) {
  debug('Sending Notification SMS to all users');

  Survey.find({status: 'completed'})
    .then(users => {
      const twilioErrors = [];
      async.eachLimit(users, 10, (user, cb) => {
        client.messages.create({
          from: nconf.get('TWILIO_NUMBER'),
          to: user.src,
          body: notificationText
        })
        .catch(err => {
          if (err && err.message) {
            twilioErrors.push(`${user.src}: ${err.message}`);
          }
          cb();
        });
      }, err => {
        if (err) {
          console.error(err);
        }
        cb(null, {twilioErrors});
      });
    }, cb);
};
