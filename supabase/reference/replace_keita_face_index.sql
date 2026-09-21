-- Reference copy of the existing production SECURITY INVOKER function.
-- Recorded after atomic-save/rollback tests; no grants or RLS policies changed.
CREATE OR REPLACE FUNCTION public.replace_keita_face_index(p_photo_id uuid, p_engine text, p_version text, p_faces jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  target public.photos%rowtype;
  item jsonb;
  val jsonb;
  face_total integer;
  norm2 double precision;
begin
  if p_engine <> 'sface-yunet-v1' or p_version <> 'sface-yunet-v1-align5-recall1'
     or p_engine is null or p_version is null then
    raise exception 'Unsupported face index version';
  end if;
  if p_faces is null or jsonb_typeof(p_faces) <> 'array' then raise exception 'Faces must be an array'; end if;
  face_total := jsonb_array_length(p_faces);
  if face_total > 4096 then raise exception 'Too many faces in one file'; end if;
  select * into target from public.photos where id = p_photo_id for update;
  if not found or target.status is distinct from 'active' then raise exception 'Photo is unavailable'; end if;
  for item in select value from jsonb_array_elements(p_faces) loop
    if jsonb_typeof(item->'descriptor') is distinct from 'array' then raise exception 'Invalid descriptor'; end if;
    if jsonb_array_length(item->'descriptor') <> 128 then raise exception 'Invalid descriptor dimension'; end if;
    norm2 := 0;
    for val in select value from jsonb_array_elements(item->'descriptor') loop
      if jsonb_typeof(val) <> 'number' then raise exception 'Invalid descriptor value'; end if;
      norm2 := norm2 + (val::text::double precision)^2;
    end loop;
    if not (norm2 between 0.99 and 1.01) then raise exception 'Descriptor must be normalized'; end if;
    if jsonb_typeof(item->'face_box') is distinct from 'object' then raise exception 'Missing face box'; end if;
    if not (
      coalesce((item->'face_box'->>'x')::double precision,-1) between 0 and 1 and
      coalesce((item->'face_box'->>'y')::double precision,-1) between 0 and 1 and
      coalesce((item->'face_box'->>'width')::double precision,-1) > 0 and
      (item->'face_box'->>'width')::double precision <= 1 and
      coalesce((item->'face_box'->>'height')::double precision,-1) > 0 and
      (item->'face_box'->>'height')::double precision <= 1
    ) then raise exception 'Invalid face box'; end if;
    if coalesce(item->>'media_type','') not in ('image','video') then raise exception 'Invalid media type'; end if;
  end loop;
  -- Validate the ENTIRE batch before replacing anything. A failed insert or
  -- photos update rolls back the deletion as part of the same transaction.
  if face_total = 0 and exists(select 1 from public.faces where photo_id=p_photo_id and engine=p_engine) then
    raise exception 'No face detected this time; the previous index was retained';
  end if;
  delete from public.faces where photo_id=p_photo_id and engine=p_engine;
  insert into public.faces(event_id,photo_id,descriptor,face_index,face_box,image_url,filename,media_type,frame_index,video_time_seconds,engine)
  select target.event_id,target.id,f.value->'descriptor',coalesce((f.value->>'face_index')::integer,(f.ordinality-1)::integer),f.value->'face_box',
    coalesce(target.r2_preview_url,target.preview_url,target.r2_watermark_url,target.watermark_url,target.r2_thumbnail_url,target.thumbnail_url),
    target.filename,f.value->>'media_type',(f.value->>'frame_index')::integer,(f.value->>'video_time_seconds')::numeric,p_engine
  from jsonb_array_elements(p_faces) with ordinality f(value,ordinality);
  update public.photos set face_sync_version=p_version,face_synced_at=now(),face_count=face_total where id=target.id;
  if not found then raise exception 'Photo update denied; face index was retained'; end if;
  return jsonb_build_object('face_count',face_total,'engine',p_engine,'version',p_version);
end;
$function$
