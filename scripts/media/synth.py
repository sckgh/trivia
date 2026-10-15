# Generates the public-domain sample melodies used by the demo content.
import math, struct, sys, wave
N = {'C4':261.63,'D4':293.66,'E4':329.63,'F4':349.23,'G4':392.0,'A4':440.0,'B4':493.88,'C5':523.25,'D5':587.33,'Ds5':622.25,'E5':659.25,'A3':220.0,'B3':246.94,'Gs4':415.3,'R':0}
SR=44100
def render(seq, bpm, out):
    beat=60/bpm; frames=bytearray()
    for note,beats in seq:
        n=int(SR*beat*beats); f=N[note]
        for i in range(n):
            t=i/SR; env=min(1,i/400)*math.exp(-3*t)
            v=0 if f==0 else env*(0.6*math.sin(2*math.pi*f*t)+0.25*math.sin(4*math.pi*f*t)+0.1*math.sin(6*math.pi*f*t))
            frames+=struct.pack('<h',int(v*20000))
    w=wave.open(out,'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(bytes(frames)); w.close()
ode=[(n,1) for n in 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4'.split()]+[('E4',1.5),('D4',0.5),('D4',2)]
elise=[('E5',.5),('Ds5',.5),('E5',.5),('Ds5',.5),('E5',.5),('B4',.5),('D5',.5),('C5',.5),('A4',1.5),('R',.5),('C4',.5),('E4',.5),('A4',.5),('B4',1.5),('R',.5),('E4',.5),('Gs4',.5),('B4',.5),('C5',1.5)]
render(ode,150,sys.argv[1]+'/ode.wav'); render(elise,140,sys.argv[1]+'/elise.wav')
