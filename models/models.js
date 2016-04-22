var mongoose = require('mongoose');

var Sms = mongoose.model('sms', new mongoose.Schema({
    messageSid: String,
    from: String,
    to: String,
    body: String,
    direction: String,
    timestamp: String
  }, {strict: true}));

var Question = new mongoose.Schema({
    number: String,
    answer: String
  }, {strict: true});

var IntroSurvey = mongoose.model('survey', new mongoose.Schema({
    src: { type: String, unique: true, trim: true },
    status: String,
    answers: [Question]
  }, {strict: true}));

var DailySurvey = mongoose.model('daily_survey', new mongoose.Schema({
    src: { type: String, unique: true, trim: true },
    date: Date,
    commuted: Boolean,
    amMode: String,
    pmMode: String
  }, {strict: true}));

var User = mongoose.model('user', new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true }
  }, {strict: true}));
