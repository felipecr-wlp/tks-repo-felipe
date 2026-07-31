const React = require('react')
const { useState, useEffect } = React

function ClockWidget() {
  const [time, setTime] = useState('')
  useEffect(function() {
    function tick() {
      setTime(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
    tick()
    var id = setInterval(tick, 1000)
    return function() { clearInterval(id) }
  }, [])
  return React.createElement('div', { className: 'border rounded-xl p-4 bg-card h-full' },
    React.createElement('h4', { className: 'text-xs font-semibold text-muted-foreground mb-3' }, 'Reloj'),
    React.createElement('div', { className: 'flex flex-col items-center gap-1' },
      React.createElement('span', { className: 'text-3xl font-mono font-bold' }, time),
      React.createElement('span', { className: 'text-xs text-muted-foreground' },
        new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      )
    )
  )
}

module.exports = { default: ClockWidget }
