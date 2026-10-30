import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileText, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { Navigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import type { OrganizationsResponse } from "@pensia-docflow/shared";
import { Button } from "../components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../components/ui/form";
import { Input } from "../components/ui/input";
import { useSession } from "../hooks/useSession";
import { useSignIn } from "../hooks/useSignIn";
import { apiGet } from "../lib/api-client";
import { getLastOrgId } from "../lib/last-org";
import { queryKeys } from "../lib/query-keys";
import { resolvePostLoginDestination } from "../lib/redirect";

/**
 * Acceso (S0, F2). Sin registro público, sin "recordarme" ni
 * "¿olvidaste tu contraseña?" (sin email configurado). Errores inline
 * debajo del formulario; el toast queda solo para el logout.
 * Si ya hay sesión, redirige sin mostrar el formulario.
 */
const loginSchema = z.object({
  email: z.string().email("Ingresá un email válido."),
  password: z.string().min(1, "Ingresá tu contraseña."),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { user, isLoading: sessionLoading } = useSession();
  const [searchParams] = useSearchParams();
  const next = searchParams.get("next");
  const signIn = useSignIn(next);
  const queryClient = useQueryClient();
  const orgsQuery = useQuery({
    queryKey: queryKeys.meOrganizations,
    queryFn: () => apiGet<OrganizationsResponse>("/me/organizations"),
    enabled: user !== null,
  });
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  if (sessionLoading) {
    return (
      <main>
        <p>Cargando…</p>
      </main>
    );
  }
  if (user !== null) {
    if (orgsQuery.isError) {
      return (
        <main>
          <p>Ocurrió un error al cargar tus organizaciones.</p>
          <button
            type="button"
            onClick={() =>
              queryClient.invalidateQueries({
                queryKey: queryKeys.meOrganizations,
              })
            }
          >
            Reintentar
          </button>
        </main>
      );
    }
    if (orgsQuery.isPending || orgsQuery.data === undefined) {
      return (
        <main>
          <p>Cargando…</p>
        </main>
      );
    }
    return (
      <Navigate
        to={resolvePostLoginDestination({
          orgs: orgsQuery.data.organizations,
          next,
          lastOrgId: getLastOrgId(),
        })}
        replace
      />
    );
  }

  function onSubmit(values: LoginValues) {
    signIn.mutate(values);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6">
        <div className="mb-6 flex items-center gap-2">
          <FileText className="h-6 w-6 text-brand" aria-hidden="true" />
          <span className="text-lg font-semibold text-text">
            PENSIA DocFlow
          </span>
        </div>
        <h1 className="mb-4 text-xl font-semibold text-text">Acceso</h1>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Correo electrónico</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="tu@correo.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {signIn.errorMessage !== null && (
              <p role="alert" className="text-sm font-medium text-negative">
                {signIn.errorMessage}
              </p>
            )}
            <Button type="submit" disabled={signIn.isPending}>
              {signIn.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {signIn.isPending ? "Ingresando…" : "Ingresar"}
            </Button>
          </form>
        </Form>
        <p className="mt-4 text-sm text-muted">
          ¿No tenés cuenta? Contactá a tu administrador.
        </p>
      </div>
    </main>
  );
}
