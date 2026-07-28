-- A direct sibling relationship, so "Legg til søsken" always works even
-- when the selected person has no parent on file to mirror — previously
-- siblinghood was only ever inferred by copying the selected person's
-- existing parent links onto the new person, which is why the feature
-- used to be disabled without a recorded parent.
alter type relationship_type add value 'sibling';
