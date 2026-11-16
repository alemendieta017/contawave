import { redirect } from 'next/navigation';

export default function NuevoCompromisoRedirectPage() {
  redirect('/commitments/new');
}
