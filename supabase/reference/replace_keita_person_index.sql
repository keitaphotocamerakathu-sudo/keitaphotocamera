-- Appearance embeddings use the existing index table and its existing RLS.
-- No existing face row, face counter, grant or policy is changed.
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS person_sync_version text;
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS person_synced_at timestamptz;
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS person_count integer;

CREATE OR REPLACE FUNCTION public.replace_keita_person_index(p_photo_id uuid, p_version text, p_persons jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  target public.photos%rowtype;
  item jsonb;
  val jsonb;
  colors jsonb;
  part text;
  total integer;
  norm2 double precision;
  engine_name constant text := 'person-osnet-x025-v1';
BEGIN
  IF p_version IS DISTINCT FROM 'person-osnet-x025-v1-rgb-hist1' THEN RAISE EXCEPTION 'Unsupported person index version'; END IF;
  IF jsonb_typeof(p_persons) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Persons must be an array'; END IF;
  total := jsonb_array_length(p_persons);
  IF total > 128 THEN RAISE EXCEPTION 'Too many persons in one image'; END IF;
  SELECT * INTO target FROM public.photos WHERE id = p_photo_id FOR UPDATE;
  IF NOT FOUND OR target.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Photo is unavailable'; END IF;
  IF target.media_type = 'video' OR coalesce(target.mime_type,'') LIKE 'video/%' THEN RAISE EXCEPTION 'Person index supports still images'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_persons) LOOP
    IF jsonb_typeof(item->'descriptor') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid descriptor'; END IF;
    IF jsonb_array_length(item->'descriptor') <> 512 THEN RAISE EXCEPTION 'Invalid descriptor dimension'; END IF;
    norm2 := 0;
    FOR val IN SELECT value FROM jsonb_array_elements(item->'descriptor') LOOP
      IF jsonb_typeof(val) <> 'number' THEN RAISE EXCEPTION 'Invalid descriptor value'; END IF;
      norm2 := norm2 + (val::text::double precision)^2;
    END LOOP;
    IF NOT (norm2 BETWEEN 0.99 AND 1.01) THEN RAISE EXCEPTION 'Descriptor must be normalized'; END IF;
    IF jsonb_typeof(item->'face_box') IS DISTINCT FROM 'object' OR NOT (
      coalesce((item->'face_box'->>'x')::double precision,-1) BETWEEN 0 AND 1 AND
      coalesce((item->'face_box'->>'y')::double precision,-1) BETWEEN 0 AND 1 AND
      coalesce((item->'face_box'->>'width')::double precision,-1) > 0 AND
      coalesce((item->'face_box'->>'height')::double precision,-1) > 0 AND
      coalesce((item->'face_box'->>'x')::double precision + (item->'face_box'->>'width')::double precision,2) <= 1.000001 AND
      coalesce((item->'face_box'->>'y')::double precision + (item->'face_box'->>'height')::double precision,2) <= 1.000001
    ) THEN RAISE EXCEPTION 'Invalid person box'; END IF;
    FOREACH part IN ARRAY ARRAY['upper','lower'] LOOP
      colors := item->'face_box'->'appearance'->part;
      IF jsonb_typeof(colors) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Missing clothing colors'; END IF;
      IF jsonb_array_length(colors) <> 11 THEN RAISE EXCEPTION 'Invalid clothing colors'; END IF;
      norm2 := 0;
      FOR val IN SELECT value FROM jsonb_array_elements(colors) LOOP
        IF jsonb_typeof(val) <> 'number' OR NOT (val::text::double precision BETWEEN 0 AND 1) THEN RAISE EXCEPTION 'Invalid color value'; END IF;
        norm2 := norm2 + val::text::double precision;
      END LOOP;
      IF NOT (norm2 BETWEEN .99 AND 1.01) THEN RAISE EXCEPTION 'Colors must be normalized'; END IF;
    END LOOP;
  END LOOP;
  IF total = 0 AND EXISTS(SELECT 1 FROM public.faces WHERE photo_id=p_photo_id AND engine=engine_name) THEN
    RAISE EXCEPTION 'No person detected this time; the previous index was retained';
  END IF;
  DELETE FROM public.faces WHERE photo_id=p_photo_id AND engine=engine_name;
  INSERT INTO public.faces(event_id,photo_id,descriptor,face_index,face_box,image_url,filename,media_type,engine)
  SELECT target.event_id,target.id,f.value->'descriptor',(f.ordinality-1)::integer,
    jsonb_build_object('x',f.value->'face_box'->'x','y',f.value->'face_box'->'y',
      'width',f.value->'face_box'->'width','height',f.value->'face_box'->'height',
      'appearance',f.value->'face_box'->'appearance'),
    coalesce(target.r2_preview_url,target.preview_url,target.r2_watermark_url,target.watermark_url),target.filename,'image',engine_name
  FROM jsonb_array_elements(p_persons) WITH ORDINALITY f(value,ordinality);
  UPDATE public.photos SET person_sync_version=p_version,person_synced_at=now(),person_count=total WHERE id=target.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Photo update denied; person index was retained'; END IF;
  RETURN jsonb_build_object('person_count',total,'engine',engine_name,'version',p_version);
END;
$function$;
REVOKE ALL ON FUNCTION public.replace_keita_person_index(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_keita_person_index(uuid,text,jsonb) TO anon, authenticated, service_role;
