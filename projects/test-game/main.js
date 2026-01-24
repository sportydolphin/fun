// Test Game: 2D Plot with Sell/Buy
const root = document.getElementById('root');

const canvas = document.createElement('canvas');
canvas.width = 500;
canvas.height = 400;
canvas.style.background = '#fff';
canvas.style.border = '1px solid #ccc';
root.appendChild(canvas);

const ctx = canvas.getContext('2d');

// Draw axes
drawAxes();

drawLabels();

function drawAxes() {
  // Y axis
  ctx.beginPath();
  ctx.moveTo(60, 30);
  ctx.lineTo(60, 370);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.stroke();

  // X axis (split middle)
  ctx.beginPath();
  ctx.moveTo(60, 370);
  ctx.lineTo(460, 370);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Middle vertical line (split)
  ctx.beginPath();
  ctx.moveTo(260, 370);
  ctx.lineTo(260, 30);
  ctx.strokeStyle = '#aaa';
  ctx.setLineDash([6, 6]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Y axis ticks and labels
  for (let i = 0; i <= 10; i++) {
    const y = 370 - (i * 34);
    ctx.beginPath();
    ctx.moveTo(55, y);
    ctx.lineTo(65, y);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#333';
    ctx.fillText(`${i * 10}%`, 50, y);
  }
}

function drawLabels() {
  // X axis labels
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#1976d2';
  ctx.fillText('SELL', 160, 380);
  ctx.fillStyle = '#43a047';
  ctx.fillText('BUY', 360, 380);
}
