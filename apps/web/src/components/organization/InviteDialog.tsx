import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserPlus } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { useInviteMember } from "../../hooks/useInviteMember";
import { getInviteErrorMessage } from "../../lib/org-errors";

const inviteSchema = z.object({
  email: z.string().trim().email("Ingresá un correo válido."),
});

type InviteValues = z.infer<typeof inviteSchema>;

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
}

/**
 * Invitar a un miembro por email (F3, S9). Sin SMTP configurado (deuda
 * B1): tras el éxito muestra el link de /sin-organizacion para
 * compartir fuera de banda, con botón de copiar.
 */
export function InviteDialog({ open, onOpenChange, orgId }: InviteDialogProps) {
  const invite = useInviteMember(orgId);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "" },
  });

  const inviteLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/sin-organizacion`
      : "/sin-organizacion";

  async function handleSubmit(values: InviteValues) {
    setCopied(false);
    try {
      await invite.mutateAsync({ email: values.email });
    } catch {
      // El error queda visible abajo (invite.error).
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
    } catch {
      // Fallback: seleccionar el campo para copiar a mano.
      linkRef.current?.select();
    }
  }

  function handleInviteAnother() {
    invite.reset();
    form.reset();
    setCopied(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <UserPlus aria-hidden="true" className="h-5 w-5 shrink-0" />
              Invitar miembro
            </span>
          </DialogTitle>
          <DialogDescription>
            El invitado se une como reviewer, sin permisos.
          </DialogDescription>
        </DialogHeader>
        {invite.isSuccess ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Sin email configurado: compartí la invitación fuera de banda.
              Quien la reciba inicia sesión y la acepta en la pantalla
              &ldquo;Sin organización&rdquo;.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              Link para compartir
              <input
                ref={linkRef}
                readOnly
                value={inviteLink}
                aria-label="Link para compartir"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
              />
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={handleCopy}>
                {copied ? "¡Link copiado!" : "Copiar link"}
              </Button>
              <Button variant="outline" onClick={handleInviteAnother}>
                Invitar otro
              </Button>
              <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="flex flex-col gap-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Correo</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="nombre@ejemplo.com"
                        autoComplete="email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {invite.error !== null && (
                <p role="alert" className="text-sm text-negative">
                  {getInviteErrorMessage(invite.error)}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={invite.isPending}>
                  <UserPlus aria-hidden="true" className="h-4 w-4" />
                  {invite.isPending ? "Invitando…" : "Invitar"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
