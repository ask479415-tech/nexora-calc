import { useEffect, useRef, useState } from 'react';
import { Check, X, Scan, RotateCcw, Crop, Move } from 'lucide-react';

type Point = { x: number; y: number };
type Props = { file: File; onCancel: () => void; onScan: (file: File) => void };
const initialCorners: Point[] = [{x:5,y:5},{x:95,y:5},{x:95,y:95},{x:5,y:95}];

function distance(a: Point, b: Point) { return Math.hypot(a.x-b.x,a.y-b.y); }
function affine(ctx: CanvasRenderingContext2D, src: Point[], dst: Point[]) {
  const [p0,p1,p2]=src, [q0,q1,q2]=dst;
  const den=p0.x*(p1.y-p2.y)+p1.x*(p2.y-p0.y)+p2.x*(p0.y-p1.y);
  if (Math.abs(den)<0.001) return;
  const a=(q0.x*(p1.y-p2.y)+q1.x*(p2.y-p0.y)+q2.x*(p0.y-p1.y))/den;
  const c=(q0.x*(p2.x-p1.x)+q1.x*(p0.x-p2.x)+q2.x*(p1.x-p0.x))/den;
  const e=(q0.x*(p1.x*p2.y-p2.x*p1.y)+q1.x*(p2.x*p0.y-p0.x*p2.y)+q2.x*(p0.x*p1.y-p1.x*p0.y))/den;
  const b=(q0.y*(p1.y-p2.y)+q1.y*(p2.y-p0.y)+q2.y*(p0.y-p1.y))/den;
  const d=(q0.y*(p2.x-p1.x)+q1.y*(p0.x-p2.x)+q2.y*(p1.x-p0.x))/den;
  const f=(q0.y*(p1.x*p2.y-p2.x*p1.y)+q1.y*(p2.x*p0.y-p0.x*p2.y)+q2.y*(p0.x*p1.y-p1.x*p0.y))/den;
  ctx.setTransform(a,b,c,d,e,f);
}
export default function CropPhotoModal({ file, onCancel, onScan }: Props) {
  const [src,setSrc]=useState('');
  const [corners,setCorners]=useState<Point[]>(initialCorners);
  const [processing,setProcessing]=useState(false);
  const imageRef=useRef<HTMLImageElement>(null);
  const frameRef=useRef<HTMLDivElement>(null);
  const dragIndex=useRef<number|null>(null);
  useEffect(()=>{const url=URL.createObjectURL(file);setSrc(url);return()=>URL.revokeObjectURL(url);},[file]);
  function point(event:React.PointerEvent, index:number) {
    const bounds=frameRef.current?.getBoundingClientRect(); if(!bounds)return;
    setCorners(old=>old.map((p,i)=>i===index?{x:Math.max(0,Math.min(100,(event.clientX-bounds.left)/bounds.width*100)),y:Math.max(0,Math.min(100,(event.clientY-bounds.top)/bounds.height*100))}:p));
  }
  function cropPoint(p:Point,image:HTMLImageElement):Point{return{x:image.naturalWidth*p.x/100,y:image.naturalHeight*p.y/100};}
  async function cropAndScan(){
    const image=imageRef.current;if(!image?.naturalWidth)return;
    setProcessing(true);
    try{
      const srcPts=corners.map(p=>cropPoint(p,image));
      const width=Math.min(3000,Math.round((distance(srcPts[0],srcPts[1])+distance(srcPts[3],srcPts[2]))/2));
      const height=Math.min(3000,Math.round((distance(srcPts[0],srcPts[3])+distance(srcPts[1],srcPts[2]))/2));
      if(width<40||height<40)throw new Error('Select a larger paper area.');
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Could not process this photo.');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
      const dstPts=[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
      const triangles=[[0,1,2],[0,2,3]];
      for(const tri of triangles){
        const si=tri.map(i=>srcPts[i]),di=tri.map(i=>dstPts[i]);
        ctx.save();ctx.beginPath();ctx.moveTo(di[0].x,di[0].y);ctx.lineTo(di[1].x,di[1].y);ctx.lineTo(di[2].x,di[2].y);ctx.closePath();ctx.clip();
        affine(ctx,si,di);ctx.drawImage(image,0,0);ctx.restore();
      }
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(new Error('Photo crop failed.')),'image/jpeg',.96));
      onScan(new File([blob],'nexora-perspective-crop.jpg',{type:'image/jpeg'}));
    }catch(error){alert(error instanceof Error?error.message:'Could not crop this photo.');setProcessing(false);}
  }
  return <div className="modal-backdrop smart-crop-backdrop" style={{zIndex:1000}}>
    <div className="smart-crop-modal">
      <header className="smart-crop-head"><div><span className="smart-crop-kicker"><Scan size={13}/> SMART DOCUMENT SCAN</span><h2>Adjust paper corners</h2><p>Drag all four blue handles to match the paper edges. The image will be straightened before reading.</p></div><button className="icon-button" onClick={onCancel} aria-label="Close"><X/></button></header>
      <div className="smart-crop-stage"><div ref={frameRef} className="smart-crop-image">
        <img ref={imageRef} src={src} alt="Document to crop" draggable={false}/>
        <svg className="smart-crop-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          <polygon points={corners.map(p=>`${p.x*10},${p.y*10}`).join(' ')} fill="rgba(37,145,255,.12)" stroke="#39a4ff" strokeWidth="5" vectorEffect="non-scaling-stroke"/>
          {[1,2].map(n=><g key={n} stroke="rgba(255,255,255,.65)" strokeWidth="2" vectorEffect="non-scaling-stroke"><line x1={corners[0].x*10+(corners[1].x-corners[0].x)*n/3*10} y1={corners[0].y*10+(corners[1].y-corners[0].y)*n/3*10} x2={corners[3].x*10+(corners[2].x-corners[3].x)*n/3*10} y2={corners[3].y*10+(corners[2].y-corners[3].y)*n/3*10}/><line x1={corners[0].x*10+(corners[3].x-corners[0].x)*n/3*10} y1={corners[0].y*10+(corners[3].y-corners[0].y)*n/3*10} x2={corners[1].x*10+(corners[2].x-corners[1].x)*n/3*10} y2={corners[1].y*10+(corners[2].y-corners[1].y)*n/3*10}/></g>)}
        </svg>
        {corners.map((p,index)=><button key={index} type="button" className="smart-crop-handle" aria-label={`Move paper corner ${index+1}`} style={{left:p.x+'%',top:p.y+'%'}} onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);dragIndex.current=index;}} onPointerMove={event=>{if(dragIndex.current===index)point(event,index);}} onPointerUp={()=>{dragIndex.current=null;}} onPointerCancel={()=>{dragIndex.current=null;}}/> )}
      </div></div>
      <div className="smart-crop-tip"><Move size={15}/><span>Move each corner handle · Keep the full paper inside the blue outline</span><button type="button" onClick={()=>setCorners(initialCorners)}><RotateCcw size={13}/> Reset</button></div>
      <div className="smart-crop-actions"><button className="secondary-action" onClick={onCancel} disabled={processing}>Cancel</button><button className="primary-action" onClick={cropAndScan} disabled={processing}><Crop size={17}/>{processing?'Straightening…':'Straighten & Scan'}<Check size={16}/></button></div>
    </div>
  </div>;
}
