/**
 * Avatar de usuario (F3.5; F3.5b: fondos más suaves). Identidad, no
 * decoración: iniciales del nombre (máx. 2 palabras) o primera letra
 * del email, y color derivado del hash del email sobre una paleta de
 * 8 pasteles con texto oscuro. Desviación documentada de la orden:
 * la orden pedía texto -600 sobre fondo -50, pero 6 de 8 pares quedan
 * bajo AA (emerald 3,58; amber 3,07; rose 4,28; cyan 3,54; orange 3,35;
 * teal 3,59); con texto -700 sobre fondo -50 todos pasan (mínimo
 * ámbar 4,84) y el fondo sigue siendo más sutil que en F3.5.
 * Determinístico: el mismo email siempre da el mismo color.
 */

const AVATAR_COLORS = [
  "bg-blue-50 text-blue-700",
  "bg-emerald-50 text-emerald-700",
  "bg-amber-50 text-amber-700",
  "bg-rose-50 text-rose-700",
  "bg-purple-50 text-purple-700",
  "bg-cyan-50 text-cyan-700",
  "bg-orange-50 text-orange-700",
  "bg-teal-50 text-teal-700",
] as const;

const AVATAR_SIZES = {
  sm: "h-6 w-6 text-xs",
  md: "h-8 w-8 text-sm",
  lg: "h-10 w-10 text-base",
} as const;

export function avatarColorForEmail(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i += 1) {
    hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initialsForUser(
  name: string | null | undefined,
  email: string,
): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return words
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join("");
  }
  return email.trim().charAt(0).toUpperCase();
}

interface UserAvatarProps {
  name?: string | null;
  email: string;
  size?: "sm" | "md" | "lg";
}

export function UserAvatar({ name, email, size = "md" }: UserAvatarProps) {
  return (
    <span
      aria-hidden="true"
      title={email}
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-medium ${AVATAR_SIZES[size]} ${avatarColorForEmail(email)}`}
    >
      {initialsForUser(name, email)}
    </span>
  );
}
