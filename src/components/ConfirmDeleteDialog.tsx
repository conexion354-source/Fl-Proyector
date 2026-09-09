import { Win11Dialog } from "./Win11Dialog";

type Props = {
  title: string
  detail: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

export function ConfirmDeleteDialog({ title, detail, onCancel, onConfirm }: Props) {
  return (
    <Win11Dialog
      open
      title="Confirmar eliminación"
      message={title}
      submessage={detail}
      confirmText="Eliminar"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
