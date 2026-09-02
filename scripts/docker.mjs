// Verifica que se pueda hablar con el daemon de Docker antes de hacer nada. Sin esto el fallo sale
// como un stack trace de Node, o como un mensaje que solo aplica a Docker Desktop: en Linux las dos
// causas habituales (daemon apagado, usuario fuera del grupo `docker`) se arreglan distinto.
import { execFileSync } from "node:child_process";

const linux = process.platform === "linux";

const ARRANCAR = linux
  ? "  sudo systemctl enable --now docker"
  : "  Abre Docker Desktop y espera a que diga «Engine running».";

export function assertDocker() {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    return;
  } catch (err) {
    const detail = `${err.stderr ?? ""}${err.message ?? ""}`;

    if (err.code === "ENOENT") {
      console.error(
        "✗ No existe el comando `docker`.\n" +
          (linux ? "  Instálalo con: sudo pacman -S docker   (o el gestor de tu distro)" : "  Instala Docker Desktop.")
      );
    } else if (/permission denied/i.test(detail)) {
      console.error(
        "✗ Sin permiso para hablar con Docker (el socket es root:docker).\n" +
          "  Agrega tu usuario al grupo y vuelve a iniciar sesión:\n" +
          "  sudo usermod -aG docker $USER\n" +
          "  Para esta sesión, sin cerrarla: newgrp docker"
      );
    } else {
      console.error(`✗ El daemon de Docker no responde. Arráncalo:\n${ARRANCAR}`);
    }
    process.exit(1);
  }
}
