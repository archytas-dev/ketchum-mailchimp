import KetchumLogo from "@/components/KetchumLogo";
import Footer from "@/components/Footer";
import PasswordInput from "./PasswordInput";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <KetchumLogo className="h-9 w-auto" />
        </div>

        <form
          action={login}
          className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 space-y-5"
        >
          <div>
            <h1 className="text-lg font-semibold text-slate-800">
              Clipping de noticias
            </h1>
            <p className="text-sm text-slate-500">Ingresá a tu cuenta</p>
          </div>

          <div className="space-y-1">
            <label className="text-sm text-slate-600">Email</label>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#243f55]/40"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-slate-600">Contraseña</label>
            <PasswordInput />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-lg bg-[#243f55] text-white text-sm font-medium py-2.5 hover:bg-[#1b3143] transition"
          >
            Entrar
          </button>
        </form>

        <Footer vertical logoSize={18} />
      </div>
    </main>
  );
}
