-- =====================================================
-- MIGRATION: Agregar políticas de DELETE para superadmins
-- =====================================================
-- Este script agrega políticas RLS que permiten a superadmins
-- eliminar registros de company_news y company_implementations
-- =====================================================

-- Política de DELETE para company_news (solo superadmins)
CREATE POLICY "Superadmins can delete news" ON company_news
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'superadmin'
    )
  );

-- Política de DELETE para company_implementations (solo superadmins)
CREATE POLICY "Superadmins can delete implementations" ON company_implementations
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'superadmin'
    )
  );
