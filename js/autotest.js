// Auto-answer dialog - simulate user interaction
(function autoTest() {
  const input = document.getElementById('dialog-input');
  if (!input) return;
  
  // Find current question's expected answer
  const turn = App.dialogTurns && App.dialogTurns[App.dialogCurrentTurn];
  if (turn && turn.speaker === 'question' && turn.expected_de) {
    input.value = turn.expected_de;
    App.dialogSend();
    setTimeout(autoTest, 2000);
  }
})();
