var moment = require('moment');
var nconf = require('nconf');
var _ = require('underscore');
var twilio = require('twilio');
var client = twilio(nconf.get('TWILIO_SID'), nconf.get('TWILIO_AUTH_TOKEN'));

var questions = require('../lib/questions');


module.exports = {
  handleIncoming: function(app, req, res) {
    var message = req.body.Body.toLowerCase();

    if (message == 'ping') {
      sendPing(app, req, res);
    } else if (message == 'reset') {
      resetQuestion(app, req, res);
    } else if (message == 'reset all') {
      resetSurvey(app, req, res);
    } else {
      doSurvey(app, req, res);
    }
  }
};


function doSurvey(app, req, res) {
  var Survey = app.set('db').model('survey');
  var Sms = app.set('db').model('sms');
  var response = req.body.Body.trim().toLowerCase();
  var nextQuestion;
  var surveyStatus;
  var controlWords = ['test', 'start'];

  Survey.findOne({src: req.body.From}, function(e, survey){
    if(!survey) {
      //create new survey object
      survey = new Survey({src: req.body.From});
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
}


function resetQuestion(app, req, res) {
  var Survey = app.set('db').model('survey');
  var Sms = app.set('db').model('sms');
  var resetMessage;
  Survey.findOne({src: req.body.From}, function(e, survey) {
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
}


function resetSurvey(app, req, res) {
  var Survey = app.set('db').model('survey');
  var Sms = app.set('db').model('sms');
  var resetMessage = "The survey has been reset. Text 'start' to retake the survey.";
  Survey.remove({src: req.body.From}, function(e) {
    sendMessage(app, req, res, resetMessage, 1);
  });
}


function sendPing(app, req, res) {
  client.sendMessage({
      to: req.body.To,
      from: nconf.get('TWILIO_NUMBER'),
      body: `Message recieved ${moment().format()}`
  }, (e, response) => {
    if (!e) {
      res.send(response)
    }
  });
}


function sendMessage(app, req, res, body, status) {
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
    //testing survey, send next question as JSON
    res.json({
      question: body,
      status: status
    });
  }
}
