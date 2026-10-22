import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {insertBracket,deleteBracketPair} from '@codemirror/autocomplete';
import {bracketCompletion} from '../src/brackets.js';

test('manual bracket input inserts pairs, skips their closer, and deletes empty pairs',()=>{
  for(const [open,close] of [['(',')'],['[',']'],['{','}']]){
    let state=EditorState.create({extensions:bracketCompletion});
    state=insertBracket(state,open).state;
    assert.equal(state.doc.toString(),open+close);assert.equal(state.selection.main.head,1);
    assert.equal(deleteBracketPair({state,dispatch:tr=>{state=tr.state;}}),true);
    assert.equal(state.doc.toString(),'');
    state=insertBracket(state,open).state;
    state=insertBracket(state,close).state;
    assert.equal(state.doc.toString(),open+close);assert.equal(state.selection.main.head,2);
  }
});

test('brackets wrap selected text; LaTeX quotes and dollar signs are not auto-paired',()=>{
  let state=EditorState.create({doc:'x+y',selection:{anchor:0,head:3},extensions:bracketCompletion});
  state=insertBracket(state,'{').state;assert.equal(state.doc.toString(),'{x+y}');
  for(const char of ["'",'"','$'])assert.equal(insertBracket(EditorState.create({extensions:bracketCompletion}),char),null);
});
