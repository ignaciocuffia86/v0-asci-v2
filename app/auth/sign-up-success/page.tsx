import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function SignUpSuccessPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10 bg-muted/20">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl text-center text-primary">
                ¡Registro Exitoso!
              </CardTitle>
              <CardDescription className="text-center">
                Revisa tu email para confirmar tu cuenta
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground text-center">
                Hemos enviado un enlace de confirmación a tu correo electrónico.
                Por favor, haz clic en el enlace para activar tu cuenta y
                comenzar a usar ASCI v2.
              </p>
              <Button asChild className="w-full" variant="outline">
                <Link href="/auth/login">Volver al Login</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
