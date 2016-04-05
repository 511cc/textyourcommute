var $ = require('jquery');

function getNextQuestion(from, body){
  $.post('/api/sms-test', {
    From: from,
    To: '+14439918747',
    Body: body,
    test: true
  }, function(data){
    console.log(data);
    switch(data.status) {
      case 'start':
        $('<div>')
          .addClass('question')
          .html(data.question)
          .appendTo('#questions');
        break;
      case 'end':
        $('<div>')
          .addClass('alert alert-success')
          .html(data.question)
          .appendTo('#questions');
        $('#answers').hide();
        break;
      default:
        $('<div>')
          .addClass('question')
          .html(data.question)
          .appendTo('#questions');
        break;
    }
  });
}


/* Test Survey Page */
$('#tester').submit(function() {
  $('#tester input[type="submit"]').hide();
  $('#tester input').attr('disabled', 'disabled');
  $('#answers').show();
  getNextQuestion($('#tester .src').val(), 'start');
  return false;
});

$('#answers').submit(function() {
  var answer = $('#answers .answer').val();
  $('#answers .answer').val('');

  $('<div>')
    .addClass('answer')
    .html('A: ' + answer)
    .appendTo('#questions');
  getNextQuestion($('#tester .src').val(), answer);
  return false;
});

$('#testSMS').submit(function() {
  $.post('/api/sms-test', {
    To: $('[name="dst"]', this).val(),
    Body: 'ping'
  }, function(data) {
    console.log(data);

    if(data && data.errorCode) {
      $('#smsResults').removeClass().addClass('alert alert-danger').text('Error: ' + data.body + ' ' + data.errorCode + ' ' + data.errorMessage);
    } else {
      $('#smsResults').removeClass().addClass('alert alert-success').text('Success: ' + data.body);
    }
  });
  return false;
});
