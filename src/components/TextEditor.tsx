import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { AlignCenter, AlignLeft, AlignRight, Bold, Eye, EyeOff, Italic, Send } from 'lucide-react'
import type { ProjectionPatch, ProjectionState } from '../../shared/types'

export function TextEditor({ state, update }: { state: ProjectionState; update: (patch: ProjectionPatch) => void }) {
  const editor = useEditor({ extensions: [StarterKit, TextAlign.configure({ types: ['heading', 'paragraph'] })], content: state.text.html })
  const send = () => update({ text: { html: editor?.getHTML() ?? '', visible: true } })
  return <section className="editor-panel">
    <div className="section-title"><div><span className="eyebrow">CAPA 2</span><h2>Texto de Biblia o canto</h2></div><div className="segmented"><button className={state.text.kind === 'biblia' ? 'active' : ''} onClick={() => update({ text: { kind: 'biblia' } })}>Biblia</button><button className={state.text.kind === 'canto' ? 'active' : ''} onClick={() => update({ text: { kind: 'canto' } })}>Canto</button></div></div>
    <div className="toolbar"><button onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={17}/></button><button onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={17}/></button><i/><button onClick={() => update({ text: { align: 'left' } })}><AlignLeft size={17}/></button><button onClick={() => update({ text: { align: 'center' } })}><AlignCenter size={17}/></button><button onClick={() => update({ text: { align: 'right' } })}><AlignRight size={17}/></button><label>Tamaño <input type="range" min="32" max="100" value={state.text.fontSize} onChange={e => update({ text: { fontSize: Number(e.target.value) } })}/><b>{state.text.fontSize}</b></label></div>
    <EditorContent editor={editor} className="rich-editor"/>
    <div className="editor-actions"><button className="secondary" onClick={() => update({ text: { visible: !state.text.visible } })}>{state.text.visible ? <EyeOff size={17}/> : <Eye size={17}/>} {state.text.visible ? 'Ocultar texto' : 'Mostrar texto'}</button><button className="primary" onClick={send}><Send size={17}/> Enviar texto al aire</button></div>
    <div className="lower-editor"><span className="eyebrow">CAPA 3 · ZÓCALO</span><div className="lower-inputs"><input value={state.lowerThird.title} placeholder="Nombre" onChange={e => update({ lowerThird: { title: e.target.value } })}/><input value={state.lowerThird.subtitle} placeholder="Cargo o descripción" onChange={e => update({ lowerThird: { subtitle: e.target.value } })}/><button className={state.lowerThird.visible ? 'danger' : 'primary'} onClick={() => update({ lowerThird: { visible: !state.lowerThird.visible } })}>{state.lowerThird.visible ? 'Ocultar' : 'Mostrar'}</button></div></div>
  </section>
}
