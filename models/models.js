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

var Survey = mongoose.model('survey', new mongoose.Schema({
    src: { type: String, unique: true, trim: true },
    neighborhood: { type: String, trim: true, index: true },
    answers: [Question]
  }, {strict: true}));

var User = mongoose.model('user', new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true }
  }, {strict: true}));
