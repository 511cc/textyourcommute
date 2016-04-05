var moment = require('moment');
var nconf = require('nconf');
var _ = require('underscore');
var questions = require('../lib/questions');


module.exports = {
  doSurvey: function(app, req, res) {
    var Survey = app.set('db').model('survey');
    var Sms = app.set('db').model('sms');
    var response = req.query.msg.trim().toLowerCase();
    var nextQuestion;
    var surveyStatus;
    var controlWords = ['test', 'start'];

    Survey.findOne({src: req.query.src}, function(e, survey){
      if(!survey) {
        //create new survey object
        survey = new Survey({src: req.query.src});
      }
      if(survey.answers.length < questions.questions.length && !_.include(controlWords, response)) {
        //don't save answer if 'test' or 'start'
        survey.answers.push({
            number: (survey.answers.length + 1)
          , answer: response
        });
      }

      if(survey.answers.length < questions.questions.length) {
        //Send next question
        nextQuestion = (survey.answers.length + 1) + ': ' + questions.questions[survey.answers.length];
        surveyStatus = (survey.answers.length + 1);
      } else {
        //send thank you text
        nextQuestion = questions.thankYouText;
        surveyStatus = 'end';
      }

      survey.save(function(e){
        sendMessage(app, req, res, nextQuestion, surveyStatus);
      });
    });
  },

  resetQuestion: function(app, req, res) {
    var Survey = app.set('db').model('survey');
    var Sms = app.set('db').model('sms');
    var resetMessage;
    Survey.findOne({src: req.query.src}, function(e, survey) {
      if(survey) {
        //remove last question if a survey exists
        survey.answers.pop();
        survey.save();
        resetMessage = (survey.answers.length + 1) + ': ' + questions.questions[survey.answers.length];
      } else {
        resetMessage = "Text 'Mulai' to begin the survey.";
      }
      //Send notice that survey has been reset
      sendMessage(app, req, res, resetMessage, (survey.answers.length + 1));
    });
  },

  resetSurvey: function(app, req, res) {
    var Survey = app.set('db').model('survey');
    var Sms = app.set('db').model('sms');
    var resetMessage = "The survey has been reset. Text 'start' to retake the survey.";
    Survey.remove({src: req.query.src}, function(e) {
      sendMessage(app, req, res, resetMessage, 1);
    });
  },

  doPing: function(app, req, res) {
    var pingText = `Message recieved ${moment().format()}`;
    sendMessage(app, req, res, pingText, 1);
  }
};

function sendMessage(app, req, res, msg, status) {
  var Sms = app.set('db').model('sms');
  // don't send SMS if `test` is true
  if(req.query.test !== 'true') {
    var twiml = new twilio.TwimlResponse();
    twiml.message(msg);
    res.send(twiml);

    var sms = new Sms({
      from: req.params.To,
      to: req.params.From,
      body: msg,
      direction: 'outbound',
      timestamp: moment().format()
    });
    sms.save();
  } else {
    //testing survey, send next question as JSON
    res.json({
      question: msg,
      status: status
    });
  }
}
