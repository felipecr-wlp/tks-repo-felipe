import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import * as fs from 'fs'
import * as path from 'path'

interface Props { params: { workspaceSlug: string } }

export default async function DocsPage(_props: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const filePath = path.join(process.cwd(), 'docs', 'plugin-development.md')
  if (!fs.existsSync(filePath)) {
    return <div className="p-8 text-muted-foreground">Documentación no encontrada</div>
  }

  const markdown = fs.readFileSync(filePath, 'utf8')
  const html = markdownToHtml(markdown)

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold">Documentación para Desarrolladores</h2>
        <p className="text-sm text-muted-foreground mt-1">Guía completa del sistema de plugins de WLO.</p>
      </div>
      <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: html }} />
      <style>{`
        .prose h1 { font-size: 1.5rem; font-weight: 700; margin-top: 2rem; margin-bottom: 1rem; }
        .prose h2 { font-size: 1.25rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.75rem; color: #1e293b; }
        .prose h3 { font-size: 1rem; font-weight: 600; margin-top: 1rem; margin-bottom: 0.5rem; }
        .prose p { margin-bottom: 0.75rem; line-height: 1.6; }
        .prose code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; font-family: monospace; }
        .prose pre { background: #1e293b; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 1rem 0; }
        .prose pre code { background: none; padding: 0; color: inherit; }
        .prose ul, .prose ol { margin-bottom: 0.75rem; padding-left: 1.5rem; }
        .prose li { margin-bottom: 0.25rem; }
        .prose table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
        .prose th, .prose td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; font-size: 0.85rem; }
        .prose th { background: #f8fafc; font-weight: 600; }
        .prose hr { margin: 1.5rem 0; border-color: #e2e8f0; }
        .prose blockquote { border-left: 3px solid #3b82f6; padding-left: 1rem; color: #64748b; margin: 1rem 0; }
        .prose a { color: #3b82f6; text-decoration: underline; }
      `}</style>
    </div>
  )
}

function markdownToHtml(md: string): string {
  let html = md
    // Headers
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold, italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    // Horizontal rules
    .replace(/^---$/gm, '<hr />')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')

  // Code blocks (fenced)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')

  // Tables
  html = html.replace(/^\|(.+)\|$/gm, (line) => {
    const cells = line.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('')
    return `<tr>${cells}</tr>`
  })

  // Lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')

  // Paragraphs (lines not starting with <)
  html = html.replace(/^(?!<[a-z]).+/gm, (line) => {
    if (line.trim() === '') return ''
    return `<p>${line}</p>`
  })

  return html
}
