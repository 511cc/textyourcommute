const mongoose = require('mongoose');

exports.SMS = mongoose.model('sms', new mongoose.Schema({
  messageSid: String,
  from: String,
  to: String,
  body: String,
  direction: String,
  timestamp: String
}, {strict: true}));

const Question = new mongoose.Schema({
  number: Number,
  answer: String
}, {strict: true});

exports.Survey = mongoose.model('survey', new mongoose.Schema({
  src: {type: String, unique: true, trim: true},
  status: String,
  answers: [Question]
}, {strict: true}));

exports.DailySurvey = mongoose.model('daily_survey', new mongoose.Schema({
  src: {type: String, trim: true},
  date: {type: Date, index: true},
  commuted: Boolean,
  amMode: String,
  pmMode: String,
  amCarpoolCount: String,
  pmCarpoolCount: String,
  amCarpoolRole: String,
  pmCarpoolRole: String,
  amRideshareOption: String,
  pmRideshareOption: String,
  amRideshareCount: String,
  pmRideshareCount: String
}, {strict: true}));

exports.User = mongoose.model('user', new mongoose.Schema({
  username: {type: String, required: true, unique: true, trim: true},
  password: {type: String, required: true}
}, {strict: true}));
