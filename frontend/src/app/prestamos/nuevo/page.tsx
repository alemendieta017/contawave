import { redirect } from 'next/navigation';

export default function PrestamosNuevoRedirectPage() {
  redirect('/loans/new');
}
