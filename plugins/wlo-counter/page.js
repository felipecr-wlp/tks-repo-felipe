const React = require('react')
const { useState } = React

function CounterWidget() {
  const [count, setCount] = useState(0)
  return React.createElement('div', { className: 'border rounded-xl p-4 bg-card h-full' },
    React.createElement('h4', { className: 'text-xs font-semibold text-muted-foreground mb-3' }, 'Contador'),
    React.createElement('div', { className: 'flex flex-col items-center gap-2' },
      React.createElement('span', { className: 'text-3xl font-bold' }, String(count)),
      React.createElement('div', { className: 'flex gap-1' },
        React.createElement('button', { onClick: function() { setCount(function(c) { return c - 1 }) }, className: 'w-8 h-8 rounded bg-muted hover:bg-accent text-sm' }, '-'),
        React.createElement('button', { onClick: function() { setCount(0) }, className: 'px-3 h-8 rounded bg-muted hover:bg-accent text-xs' }, 'Reset'),
        React.createElement('button', { onClick: function() { setCount(function(c) { return c + 1 }) }, className: 'w-8 h-8 rounded bg-muted hover:bg-accent text-sm' }, '+'),
      )
    )
  )
}

module.exports = { default: CounterWidget }
